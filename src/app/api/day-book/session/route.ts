import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getNstDateString } from '@/lib/timezone'
import { computeCarriedOverOpeningBalances } from '@/lib/ledger'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/day-book/session  — Open today's day book session
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
    const currentUser = await getCurrentUser()
    const restaurantId = currentUser.restaurantId

    const body = await request.json().catch(() => ({}))
    // Only ever used for the restaurant's first-ever day, when there is no
    // closed session to carry a balance over from. Every later day takes the
    // previous day's closing balances, whatever is sent here — the till staff
    // are not asked for an amount, so a typo cannot break the chain.
    const firstTimeOpeningBalance: number = Number(body.opening_balance ?? 0)
    const firstTimeOpeningBankBalance: number = Number(body.opening_bank_balance ?? 0)

    // Accept client local date if provided to handle timezones robustly
    const today = body.date ?? getNstDateString() // 'YYYY-MM-DD'

    const supabase = await createAdminClient()

    // ── 0. Prevent opening a new day if a previous day is still open ──────────
    const { data: openSession, error: checkOpenError } = await supabase
        .from('day_book_sessions')
        .select('date')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open')
        .lt('date', today)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (checkOpenError) {
        return NextResponse.json({ error: checkOpenError.message }, { status: 500 })
    }

    if (openSession) {
        return NextResponse.json(
            { error: `Cannot open a new day book session. The session for ${openSession.date} is still open. Please close it before opening a new day.` },
            { status: 400 }
        )
    }

    // ── 1. Return existing session if already opened today ──────────────────
    const { data: existing } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', today)
        .maybeSingle()

    if (existing) {
        if (existing.status === 'open') {
            return NextResponse.json({ success: true, data: existing })
        }

        // Today's session already exists but was closed — e.g. closed by
        // mistake, or someone is retrying registers after a close. Returning
        // the closed row here (the old behavior) told the caller "opened
        // successfully" while every panel stayed locked. Re-opening a closed
        // day is the same sensitive action PATCH `action=reopen` gates to
        // managers/super_admins, so mirror that check here instead of lying.
        const canReopen = ['manager', 'super_admin'].includes(currentUser.role as string)
        if (!canReopen) {
            return NextResponse.json(
                { error: `Business day ${today} was already closed. Ask a manager to re-open it.` },
                { status: 403 }
            )
        }

        const { data: reopened, error: reopenError } = await supabase
            .from('day_book_sessions')
            .update({ status: 'open', closed_at: null, closed_by: null })
            .eq('id', existing.id)
            .eq('restaurant_id', restaurantId)
            .select()
            .single()

        if (reopenError) {
            return NextResponse.json({ error: reopenError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: reopened })
    }

    // ── 2. Opening balances = the previous day's closing balances ────────────
    // Carried over server-side rather than posted from the screen that opens
    // the day: the cash and bank books have to join up across the close, and
    // the only figure that does that is the one the closed day ended on.
    const carried = await computeCarriedOverOpeningBalances(supabase, restaurantId, today)

    const openingBalance = carried?.openingBalance ?? firstTimeOpeningBalance
    const openingBankBalance = carried?.openingBankBalance ?? firstTimeOpeningBankBalance

    // ── 3. Create the new session ────────────────────────────────────────────
    const { data: session, error } = await supabase
        .from('day_book_sessions')
        .insert({
            restaurant_id:   restaurantId,
            date:            today,
            opening_balance: openingBalance,
            opening_bank_balance: openingBankBalance,
            status:          'open',
            created_by:      currentUser.id,
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: session }, { status: 201 })
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/day-book/session  — Close the current day session
// Body: { session_id: string, notes?: string }
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser()
    const restaurantId = currentUser.restaurantId

    const body = await request.json().catch(() => ({}))
    const { session_id, notes, action } = body

    if (!session_id) {
        return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    // Verify session belongs to this restaurant
    const { data: existing, error: fetchError } = await supabase
        .from('day_book_sessions')
        .select('id, status, date')
        .eq('id', session_id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!existing) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // ── Re-open Action ────────────────────────────────────────────────────────
    if (action === 'reopen') {
        const allowedRoles = ['manager', 'super_admin']
        if (!allowedRoles.includes(currentUser.role as string)) {
            return NextResponse.json(
                { error: 'Only managers and super admins can re-open the day book' },
                { status: 403 }
            )
        }

        // Only one session may be open at a time — if closing this one already
        // auto-opened a newer session, that one has to be closed first, or
        // re-opening this older one would leave two sessions open together and
        // split where new transactions land.
        const { data: newerOpen } = await supabase
            .from('day_book_sessions')
            .select('date')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'open')
            .gt('date', existing.date)
            .maybeSingle()

        if (newerOpen) {
            return NextResponse.json(
                { error: `Cannot re-open — the day book for ${newerOpen.date} is already open. Close it first.` },
                { status: 409 }
            )
        }

        const { data: session, error } = await supabase
            .from('day_book_sessions')
            .update({
                status:    'open',
                closed_at: null,
                closed_by: null,
            })
            .eq('id', session_id)
            .eq('restaurant_id', restaurantId)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data: session })
    }

    // ── Close Action ──────────────────────────────────────────────────────────
    if (existing.status === 'closed') {
        return NextResponse.json({ error: 'Session is already closed' }, { status: 409 })
    }

    const { data: session, error } = await supabase
        .from('day_book_sessions')
        .update({
            status:    'closed',
            closed_at: new Date().toISOString(),
            closed_by: currentUser.id,
            ...(notes !== undefined ? { notes } : {}),
        })
        .eq('id', session_id)
        .eq('restaurant_id', restaurantId)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Closing business day locks all entries and sets session status to closed.
    // The business will remain closed until a Cashier, Manager, or Super Admin explicitly opens it.
    return NextResponse.json({ success: true, data: session })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/day-book/session  — Get today's session with entries and totals
// Query params: date (optional, defaults to today, format: YYYY-MM-DD)
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
    const currentUser = await getCurrentUser()
    const restaurantId = currentUser.restaurantId

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') ?? getNstDateString()

    const supabase = await createAdminClient()

    // ── 0. "Is any day still open?" ──────────────────────────────────────────
    // Asked by the business-day reminder, which needs the newest OPEN session
    // whatever its date — not today's. A day left open yesterday still lets
    // every panel through the guard while its takings post to yesterday's
    // books, and the POST above refuses to open today until it is closed. So
    // the one thing worth nagging about is invisible to a per-date lookup.
    if (searchParams.get('open') === '1') {
        const { data: openSession, error: openError } = await supabase
            .from('day_book_sessions')
            .select('id, date, status, opening_balance, opening_bank_balance')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'open')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (openError) {
            return NextResponse.json({ error: openError.message }, { status: 500 })
        }
        // No open day is a normal answer, not a 404 — the caller acts on it.
        return NextResponse.json({ success: true, data: { session: openSession ?? null } })
    }

    // ── 1. Fetch the session ─────────────────────────────────────────────────
    const { data: session, error: sessionError } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', date)
        .maybeSingle()

    if (sessionError) {
        return NextResponse.json({ error: sessionError.message }, { status: 500 })
    }
    if (!session) {
        return NextResponse.json({ error: 'No session found for this date' }, { status: 404 })
    }

    // ── 2. Fetch all entries for that session ────────────────────────────────
    const { data: entries, error: entriesError } = await supabase
        .from('day_book_entries')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true })

    if (entriesError) {
        return NextResponse.json({ error: entriesError.message }, { status: 500 })
    }

    // ── 3. Calculate totals ──────────────────────────────────────────────────
    const total_cash_in = (entries ?? [])
        .filter((e) => e.type === 'cash_in')
        .reduce((sum, e) => sum + Number(e.amount), 0)

    const total_cash_out = (entries ?? [])
        .filter((e) => e.type === 'cash_out')
        .reduce((sum, e) => sum + Number(e.amount), 0)

    const closing_balance =
        Number(session.opening_balance) + total_cash_in - total_cash_out

    const total_bank_in = (entries ?? [])
        .filter((e) => e.type === 'bank_in')
        .reduce((sum, e) => sum + Number(e.amount), 0)

    const total_bank_out = (entries ?? [])
        .filter((e) => e.type === 'bank_out')
        .reduce((sum, e) => sum + Number(e.amount), 0)

    const closing_bank_balance =
        Number(session.opening_bank_balance ?? 0) + total_bank_in - total_bank_out

    const totals = {
        total_cash_in,
        total_cash_out,
        closing_balance,
        total_bank_in,
        total_bank_out,
        closing_bank_balance,
    }

    return NextResponse.json({
        success: true,
        data: { session, entries: entries ?? [], totals },
    })
}
