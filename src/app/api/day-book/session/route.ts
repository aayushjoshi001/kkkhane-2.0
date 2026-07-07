import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/day-book/session  — Open today's day book session
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
    const currentUser = await getCurrentUser()
    const restaurantId = currentUser.restaurantId

    const body = await request.json().catch(() => ({}))
    // first_time_opening_balance is only used when there is no prior session at all
    const firstTimeOpeningBalance: number = Number(body.opening_balance ?? 0)
    const firstTimeOpeningBankBalance: number = Number(body.opening_bank_balance ?? 0)

    const supabase = await createAdminClient()
    const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

    // ── 1. Return existing session if already opened today ──────────────────
    const { data: existing } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', today)
        .maybeSingle()

    if (existing) {
        return NextResponse.json({ success: true, data: existing })
    }

    // ── 2. Calculate opening balance from yesterday's closing balance ────────
    const { data: lastSession } = await supabase
        .from('day_book_sessions')
        .select('id, opening_balance, opening_bank_balance')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'closed')
        .lt('date', today)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    let openingBalance = firstTimeOpeningBalance
    let openingBankBalance = firstTimeOpeningBankBalance

    if (lastSession) {
        const { data: totals } = await supabase
            .from('day_book_entries')
            .select('type, amount')
            .eq('session_id', lastSession.id)

        // Cash calculations
        const cashIn  = (totals ?? [])
            .filter((e) => e.type === 'cash_in')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        const cashOut = (totals ?? [])
            .filter((e) => e.type === 'cash_out')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        openingBalance = Number(lastSession.opening_balance) + cashIn - cashOut
        if (openingBalance < 0) openingBalance = 0

        // Bank calculations
        const bankIn  = (totals ?? [])
            .filter((e) => e.type === 'bank_in')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        const bankOut = (totals ?? [])
            .filter((e) => e.type === 'bank_out')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        openingBankBalance = Number(lastSession.opening_bank_balance ?? 0) + bankIn - bankOut
        if (openingBankBalance < 0) openingBankBalance = 0
    }

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
    const { session_id, notes } = body

    if (!session_id) {
        return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    // Verify session belongs to this restaurant and is still open
    const { data: existing, error: fetchError } = await supabase
        .from('day_book_sessions')
        .select('id, status')
        .eq('id', session_id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!existing) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
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
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

    const supabase = await createAdminClient()

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
