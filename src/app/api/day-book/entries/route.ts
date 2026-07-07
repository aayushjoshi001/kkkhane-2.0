import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/day-book/entries  — Add a cash_in or cash_out entry
// Body: {
//   session_id:   string
//   type:         'cash_in' | 'cash_out'
//   amount:       number          (must be > 0)
//   description:  string          (1–500 chars)
//   category?:    string          (defaults to 'other')
//   reference_id?: string         (optional UUID link to order/booking)
// }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
    const currentUser = await getCurrentUser()
    const restaurantId = currentUser.restaurantId

    const body = await request.json().catch(() => ({}))
    const { session_id, type, amount, description, category, reference_id } = body

    // ── Validate required fields ─────────────────────────────────────────────
    if (!session_id) {
        return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }
    if (type !== 'cash_in' && type !== 'cash_out') {
        return NextResponse.json(
            { error: 'type must be "cash_in" or "cash_out"' },
            { status: 400 }
        )
    }
    const parsedAmount = Number(amount)
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
        return NextResponse.json({ error: 'amount must be a number greater than 0' }, { status: 400 })
    }
    if (
        !description ||
        typeof description !== 'string' ||
        description.trim().length < 1 ||
        description.length > 500
    ) {
        return NextResponse.json(
            { error: 'description is required and must be between 1 and 500 characters' },
            { status: 400 }
        )
    }

    const supabase = await createAdminClient()

    // ── Verify session is open and belongs to this restaurant ────────────────
    const { data: session, error: sessionError } = await supabase
        .from('day_book_sessions')
        .select('id, status')
        .eq('id', session_id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (sessionError) {
        return NextResponse.json({ error: sessionError.message }, { status: 500 })
    }
    if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (session.status !== 'open') {
        return NextResponse.json(
            { error: 'Cannot add entries to a closed session' },
            { status: 409 }
        )
    }

    // ── Insert the entry ─────────────────────────────────────────────────────
    const { data: entry, error } = await supabase
        .from('day_book_entries')
        .insert({
            session_id,
            restaurant_id: restaurantId,
            type,
            amount:        parsedAmount,
            description:   description.trim(),
            category:      category ?? 'other',
            ...(reference_id ? { reference_id } : {}),
            created_by:    currentUser.id,
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: entry }, { status: 201 })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/day-book/entries  — Delete an entry (manager / super_admin only)
// Body: { entry_id: string }
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(request: Request) {
    const currentUser = await getCurrentUser()
    const restaurantId = currentUser.restaurantId

    // ── Role gate: only manager / super_admin may delete entries ────────────
    const allowedRoles = ['manager', 'super_admin']
    if (!allowedRoles.includes(currentUser.role as string)) {
        return NextResponse.json(
            { error: 'Only managers and super admins can delete day book entries' },
            { status: 403 }
        )
    }

    const body = await request.json().catch(() => ({}))
    const { entry_id } = body

    if (!entry_id) {
        return NextResponse.json({ error: 'entry_id is required' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    // ── Fetch the entry to verify it exists and get its session ─────────────
    const { data: entry, error: fetchError } = await supabase
        .from('day_book_entries')
        .select('id, session_id, restaurant_id')
        .eq('id', entry_id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!entry) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    // ── Verify the parent session is still open ──────────────────────────────
    const { data: session, error: sessionError } = await supabase
        .from('day_book_sessions')
        .select('id, status')
        .eq('id', entry.session_id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (sessionError) {
        return NextResponse.json({ error: sessionError.message }, { status: 500 })
    }
    if (!session || session.status !== 'open') {
        return NextResponse.json(
            { error: 'Cannot delete entries from a closed session' },
            { status: 409 }
        )
    }

    // ── Delete ───────────────────────────────────────────────────────────────
    const { error } = await supabase
        .from('day_book_entries')
        .delete()
        .eq('id', entry_id)
        .eq('restaurant_id', restaurantId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: { id: entry_id } })
}
