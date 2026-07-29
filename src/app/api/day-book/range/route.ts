import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isValidDateString } from '@/lib/timezone'
import { computeDayBookRange } from '@/lib/ledger'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/day-book/range?from=YYYY-MM-DD&to=YYYY-MM-DD&type=cash|bank|all
//
// The multi-day counterpart to /api/day-book/session, which only ever reads
// one date. Backs the Bank Book / Cash Book "statement for a range" panels
// (Day Book's own range view queries computeDayBookRange directly from its
// server component instead, since it already has a Supabase client there).
// `type` narrows to just the cash or bank side, matching how each page's
// live-session view already only shows its own entry types.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const type = searchParams.get('type') || 'all'

    if (!from || !to || !isValidDateString(from) || !isValidDateString(to)) {
        return NextResponse.json({ error: 'from and to are required, as YYYY-MM-DD' }, { status: 400 })
    }
    if (from > to) {
        return NextResponse.json({ error: 'from must not be after to' }, { status: 400 })
    }
    if (type !== 'all' && type !== 'cash' && type !== 'bank') {
        return NextResponse.json({ error: 'type must be "cash", "bank" or "all"' }, { status: 400 })
    }

    const supabase = await createAdminClient()
    const result = await computeDayBookRange(supabase, currentUser.restaurantId, from, to, type)

    return NextResponse.json({ success: true, data: { from, to, ...result } })
}
