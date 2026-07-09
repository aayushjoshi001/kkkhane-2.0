import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveBankAccountId, isCategoryOwned } from '@/lib/ledger'

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
    const { session_id, type, amount, description, category, reference_id, bank_name, expense_category_id } = body

    // ── Validate required fields ─────────────────────────────────────────────
    if (!session_id) {
        return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
    }
    if (type !== 'cash_in' && type !== 'cash_out' && type !== 'bank_in' && type !== 'bank_out') {
        return NextResponse.json(
            { error: 'type must be "cash_in", "cash_out", "bank_in" or "bank_out"' },
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

    if (category === 'bank_deposit' && (!bank_name || !bank_name.trim())) {
        return NextResponse.json({ error: 'bank_name is required for bank deposits' }, { status: 400 })
    }
    // An 'expense' only makes sense on money leaving the till/account. Reject
    // it on incoming entries rather than accepting the request and quietly
    // skipping the expenses row the caller asked for.
    const isOutgoing = type === 'cash_out' || type === 'bank_out'
    if (category === 'expense' && !isOutgoing) {
        return NextResponse.json(
            { error: 'expense entries must be "cash_out" or "bank_out"' },
            { status: 400 }
        )
    }
    if (category === 'expense' && !expense_category_id) {
        return NextResponse.json({ error: 'expense_category_id is required for expense entries' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    if (category === 'expense') {
        const owned = await isCategoryOwned(supabase, restaurantId, 'expense_categories', expense_category_id)
        if (!owned) {
            return NextResponse.json({ error: 'Expense category not found' }, { status: 404 })
        }
    }

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
            bank_name:     bank_name ? String(bank_name).trim() || null : null,
            ...(reference_id ? { reference_id } : {}),
            created_by:    currentUser.id,
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Manual expense entries also get an expenses row so they show up in
    // the Expense tracker like every other module's payments do. It carries
    // day_book_entry_id so deleting this entry cascades the expense away.
    if (category === 'expense') {
        const bankAccountId = type === 'bank_out'
            ? await resolveBankAccountId(supabase, restaurantId, bank_name)
            : null

        const { error: expenseErr } = await supabase
            .from('expenses')
            .insert({
                restaurant_id: restaurantId,
                category_id: expense_category_id,
                day_book_entry_id: entry.id,
                amount: parsedAmount,
                description: description.trim(),
                bank_account_id: bankAccountId,
                status: 'paid',
                approved_by: currentUser.id,
                approved_at: new Date().toISOString(),
                created_by: currentUser.id,
            })

        // The entry and its expense record are meant to be one transaction.
        // Rather than report success on a half-written pair, undo the entry.
        if (expenseErr) {
            console.error('Failed to post Cash Book expense record:', expenseErr)
            await supabase.from('day_book_entries').delete().eq('id', entry.id)
            return NextResponse.json(
                { error: `Failed to record the expense: ${expenseErr.message}` },
                { status: 500 }
            )
        }
    }

    return NextResponse.json({ success: true, data: entry }, { status: 201 })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/day-book/entries  — Delete an entry (manager / super_admin only)
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

    // Read ID from query string or body
    const { searchParams } = new URL(request.url)
    let entry_id = searchParams.get('id')

    if (!entry_id) {
        const body = await request.json().catch(() => ({}))
        entry_id = body.entry_id
    }

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
    // Any expenses / staff_ledger row this entry created is removed with it by
    // the day_book_entry_id foreign key's ON DELETE CASCADE.
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
