// Shared "did money move" engine for the Resources section. Every module
// that touches the Day Book (Vouchers, Suppliers, Staff, Income & Expenses,
// Cash Book) used to check for an open session and insert a day_book_entries
// row with its own copy-pasted logic — this centralizes that so all of them
// stay correlated (same session lookup, same bank-account resolution, same
// row shape) instead of drifting apart.

import { SupabaseClient } from '@supabase/supabase-js'
import { addDays, getNstDateString } from './timezone'
import { DayBookEntry, DayBookEntryCategory, DayBookEntryType, DayBookSession } from '@/types/database'

export interface LedgerUser {
    id: string
    restaurantId: string
}

export interface PostFinancialTransactionInput {
    type: DayBookEntryType
    amount: number
    description: string
    category: DayBookEntryCategory
    bankName?: string | null
    // Vouchers hard-fail without an open session; Suppliers/Staff/Income &
    // Expenses silently skip the Day Book posting (the underlying
    // expense/income/staff_ledger record still gets created either way).
    requireOpenSession?: boolean
    // Defaults to '*'. Vouchers joins in the session date for display.
    selectClause?: string
    referenceId?: string | null
}

export interface PostFinancialTransactionResult {
    posted: boolean
    sessionId?: string
    bankAccountId?: string | null
    entry?: DayBookEntry & Record<string, unknown>
    error?: string
}

// Finds the restaurant's currently open session, regardless of its `date`.
// A session stays the "active" one across midnight until a manager
// explicitly closes it — e.g. a restaurant open until 2am still posts
// against the session opened the previous calendar day, not a new one keyed
// off today's date. (There should only ever be one open session at a time;
// the `order`+`limit(1)` is just defensive against stray duplicates.)
export async function findOpenDayBookSessionId(
    supabase: SupabaseClient,
    restaurantId: string
): Promise<string | undefined> {
    const { data } = await supabase
        .from('day_book_sessions')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data?.id
}

// What a new day's opening cash/bank balance should be, carried over from the
// most recently closed session (0/0 if there has never been a prior one) —
// the same calculation /api/day-book/session's manual "open day" route uses,
// shared here so auto-opening a session below can never drift from it.
async function computeCarriedOverOpeningBalances(
    supabase: SupabaseClient,
    restaurantId: string,
    beforeDate: string
): Promise<{ openingBalance: number; openingBankBalance: number }> {
    const { data: lastSession } = await supabase
        .from('day_book_sessions')
        .select('id, opening_balance, opening_bank_balance')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'closed')
        .lt('date', beforeDate)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!lastSession) return { openingBalance: 0, openingBankBalance: 0 }

    const { data: totals } = await supabase
        .from('day_book_entries')
        .select('type, amount')
        .eq('session_id', lastSession.id)

    const sumType = (t: string) =>
        (totals ?? []).filter((e) => e.type === t).reduce((sum, e) => sum + Number(e.amount), 0)

    let openingBalance = Number(lastSession.opening_balance) + sumType('cash_in') - sumType('cash_out')
    if (openingBalance < 0) openingBalance = 0

    let openingBankBalance = Number(lastSession.opening_bank_balance ?? 0) + sumType('bank_in') - sumType('bank_out')
    if (openingBankBalance < 0) openingBankBalance = 0

    return { openingBalance, openingBankBalance }
}

// Returns the restaurant's currently-open Day Book session id, auto-opening
// today's (with the balance carried over above) if none is open at all -
// so a real payment never silently fails to post into the Day Book just
// because nobody clicked "open session" yet this morning. Never opens a
// second session while an earlier, still-unclosed day's session exists -
// posts into that one instead, since it represents the same still-ongoing
// drawer period.
export async function getOrCreateOpenDayBookSessionId(
    supabase: SupabaseClient,
    restaurantId: string,
    createdBy: string
): Promise<string | undefined> {
    const { data: anyOpen } = await supabase
        .from('day_book_sessions')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (anyOpen) return anyOpen.id

    const today = getNstDateString()
    const { openingBalance, openingBankBalance } = await computeCarriedOverOpeningBalances(supabase, restaurantId, today)

    const { data: session, error } = await supabase
        .from('day_book_sessions')
        .insert({
            restaurant_id: restaurantId,
            date: today,
            opening_balance: openingBalance,
            opening_bank_balance: openingBankBalance,
            status: 'open',
            created_by: createdBy,
        })
        .select('id')
        .single()

    if (error) {
        console.error('[ledger] Failed to auto-open Day Book session:', error)
        return undefined
    }
    return session?.id
}

// Opens the next day's session immediately after `closedSession` is closed,
// carrying its closing cash/bank balances forward as the new opening
// balances. Dated `closedSession.date + 1` (not "today"), so a manager who
// closes late still gets a session sequenced right after the one they just
// closed. Race-safe: if two requests both try to open the same next date
// (e.g. Cash Book and Bank Book pages loading concurrently), the unique
// (restaurant_id, date) constraint rejects the loser, which then just reads
// back the row the winner created.
export async function autoOpenNextDayBookSession(
    supabase: SupabaseClient,
    restaurantId: string,
    closedSession: Pick<DayBookSession, 'id' | 'date' | 'opening_balance' | 'opening_bank_balance'>,
    createdBy: string | null
): Promise<DayBookSession | null> {
    const { data: entries } = await supabase
        .from('day_book_entries')
        .select('type, amount')
        .eq('session_id', closedSession.id)

    const sum = (t: DayBookEntryType) =>
        (entries ?? []).filter((e: { type: string }) => e.type === t).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0)

    const openingBalance = Math.max(0, Number(closedSession.opening_balance) + sum('cash_in') - sum('cash_out'))
    const openingBankBalance = Math.max(0, Number(closedSession.opening_bank_balance ?? 0) + sum('bank_in') - sum('bank_out'))
    const nextDate = addDays(closedSession.date, 1)

    const { data: newSession, error } = await supabase
        .from('day_book_sessions')
        .insert({
            restaurant_id: restaurantId,
            date: nextDate,
            opening_balance: openingBalance,
            opening_bank_balance: openingBankBalance,
            status: 'open',
            created_by: createdBy,
        })
        .select('*')
        .single()

    if (!error) return newSession as DayBookSession

    const { data: existing } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', nextDate)
        .maybeSingle()
    return (existing as DayBookSession) ?? null
}

// Resolves "the day book session active right now" for a restaurant: the
// open one if any (even if it's still dated yesterday and hasn't been
// closed), otherwise auto-opens the next one carrying forward the last
// closed session's balances — so a manager only ever enters an opening
// balance manually once, the very first time the restaurant uses the Day
// Book. Returns null only in that true first-time case, when there is no
// prior balance to carry forward and the caller must collect one.
export async function resolveActiveDayBookSession(
    supabase: SupabaseClient,
    restaurantId: string,
    createdBy: string | null
): Promise<DayBookSession | null> {
    const { data: openSession } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (openSession) return openSession as DayBookSession

    const { data: lastClosed } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'closed')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!lastClosed) return null

    return autoOpenNextDayBookSession(supabase, restaurantId, lastClosed as DayBookSession, createdBy)
}

// `%` and `_` are wildcards to ilike, so a bank literally named "50_50" would
// otherwise match more rows than it should.
function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// Matched case-insensitively so renaming an account "nabil bank" -> "Nabil Bank"
// doesn't silently stop resolving entries already written under the old
// casing. Bank Ledger has always compared these names case-insensitively.
export async function resolveBankAccountId(
    supabase: SupabaseClient,
    restaurantId: string,
    bankName?: string | null
): Promise<string | null> {
    if (!bankName?.trim()) return null
    const { data } = await supabase
        .from('bank_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .ilike('name', escapeLikePattern(bankName.trim()))
        .maybeSingle()
    return data?.id ?? null
}

// Confirms a category actually belongs to the caller's restaurant before it is
// written onto an expense/income row. Without this, a caller could attach a
// spend to another tenant's category id.
export async function isCategoryOwned(
    supabase: SupabaseClient,
    restaurantId: string,
    table: 'expense_categories' | 'income_categories',
    categoryId: string
): Promise<boolean> {
    const { data } = await supabase
        .from(table)
        .select('id')
        .eq('id', categoryId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()
    return !!data
}

export interface ParsedEntryDescription {
    status?: string
    amount?: number
    [key: string]: unknown
}

// day_book_entries has no dedicated status column — vouchers pack a status
// (e.g. 'pending_approval') and the real amount into the JSON description,
// leaving `amount` at a 0.01 placeholder until approval. Centralizes the
// "try to parse, fall back to plain text" check duplicated across Bank Book
// and Vouchers so new callers don't write a 4th copy of it.
export function parseEntryDescription(description: string): ParsedEntryDescription | null {
    if (!description?.startsWith('{')) return null
    try {
        return JSON.parse(description)
    } catch {
        return null
    }
}

export interface BalanceResult {
    inTotal: number
    outTotal: number
    closing: number
}

// The `opening + in - out = closing` arithmetic duplicated inline in the
// Cash Book and Bank Book pages. Given a flat list of day_book_entries and
// the type strings that count as "in" vs "out" (e.g. 'cash_in'/'cash_out'),
// returns the three numbers callers actually want.
export function computeBalance(
    entries: Pick<DayBookEntry, 'type' | 'amount'>[],
    openingBalance: number,
    inType: DayBookEntryType,
    outType: DayBookEntryType
): BalanceResult {
    const inTotal = entries.filter(e => e.type === inType).reduce((sum, e) => sum + Number(e.amount), 0)
    const outTotal = entries.filter(e => e.type === outType).reduce((sum, e) => sum + Number(e.amount), 0)
    return { inTotal, outTotal, closing: Number(openingBalance) + inTotal - outTotal }
}

// The single canonical write path for day_book_entries. Looks up today's
// (NST) open session, resolves the named bank account if any, and inserts
// the entry. Callers layer their own category-specific record (expenses,
// income_entries, staff_ledger) on top of this.
export async function postFinancialTransaction(
    supabase: SupabaseClient,
    user: LedgerUser,
    input: PostFinancialTransactionInput
): Promise<PostFinancialTransactionResult> {
    let sessionId = await findOpenDayBookSessionId(supabase, user.restaurantId)

    if (!sessionId) {
        if (input.requireOpenSession) {
            return { posted: false, error: 'No active Day Book session is open. Please open Cash Book or Bank Book to start a session first.' }
        }
        // Previously silently gave up here, leaving this entry recorded in
        // Income & Expenses / Suppliers / Staff but missing from the Day
        // Book with no warning. Auto-open (or reuse an already-open, older)
        // session instead so it always ends up on the books.
        sessionId = await getOrCreateOpenDayBookSessionId(supabase, user.restaurantId, user.id)
        if (!sessionId) {
            return { posted: false }
        }
    }

    const bankAccountId = await resolveBankAccountId(supabase, user.restaurantId, input.bankName)

    const { data: entry, error } = await supabase
        .from('day_book_entries')
        .insert({
            session_id: sessionId,
            restaurant_id: user.restaurantId,
            type: input.type,
            amount: input.amount,
            description: input.description,
            category: input.category,
            bank_name: input.bankName?.trim() || null,
            created_by: user.id,
            reference_id: input.referenceId || null
        })
        .select(input.selectClause || '*')
        .single() as { data: (DayBookEntry & Record<string, unknown>) | null, error: { message: string } | null }

    if (error) return { posted: false, sessionId, bankAccountId, error: error.message }

    return { posted: true, sessionId, bankAccountId, entry: entry ?? undefined }
}

export async function postHotelPaymentIncomeAndLedger(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string | null,
    input: {
        // Unused inside this function (kept for hotel callers' convenience/
        // audit clarity) — optional so dine-in callers (no booking) can omit it.
        bookingId?: string
        // Only read for the default description fallback below — dine-in
        // callers that pass their own `description` can omit it too.
        roomNumber?: string
        guestName: string
        amount: number
        paymentMethod: 'cash' | 'qr_digital' | 'card'
        isAdvance: boolean
        // Which of the restaurant's (possibly several) registered QR codes the
        // customer actually scanned — lets the payment land in that QR's own
        // bank account instead of a single restaurant-wide default. Ignored
        // for cash.
        qrCodeId?: string | null
        // Overrides so dine-in table settlement (src/app/api/tables/checkout)
        // can reuse this instead of forking a near-identical function — only
        // the income category, Day Book category, and description text
        // differ between "a hotel stay was paid" and "a table's bill was
        // paid". Hotel callers omit these and get the original behavior.
        incomeCategoryName?: string
        dayBookCategory?: DayBookEntryCategory
        description?: string
    }
): Promise<{ success: boolean; error?: string }> {
    if (input.amount <= 0) return { success: true }

    // 1. Find or create the income category (defaults to 'Room Revenue')
    const categoryName = input.incomeCategoryName || 'Room Revenue'
    let categoryId: string | undefined
    const { data: existingCategory } = await supabase
        .from('income_categories')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('name', categoryName)
        .maybeSingle()

    categoryId = existingCategory?.id
    if (!categoryId) {
        const { data: newCategory } = await supabase
            .from('income_categories')
            .insert({ restaurant_id: restaurantId, name: categoryName })
            .select('id')
            .single()
        categoryId = newCategory?.id
    }
    if (!categoryId) return { success: false, error: `Failed to find/create ${categoryName} category` }

    // 2. Resolve bank account ID if QR or card. Preference order:
    //    a) the specific QR code the customer scanned (input.qrCodeId), for
    //       restaurants running multiple QR codes into different banks
    //    b) the legacy single restaurant-wide QR bank link (pre-multi-QR)
    //    c) an arbitrary active bank account, as a last resort
    let bankAccountId: string | null = null
    let bankName: string | null = null
    if (input.paymentMethod === 'qr_digital' || input.paymentMethod === 'card') {
        let resolvedBank: { id: string; name: string; is_active: boolean } | null = null

        if (input.qrCodeId) {
            const { data: qrCodeRow } = await supabase
                .from('payment_qr_codes')
                .select('bank:bank_accounts!bank_account_id(id, name, is_active)')
                .eq('id', input.qrCodeId)
                .eq('restaurant_id', restaurantId)
                .eq('is_active', true)
                .maybeSingle()
            resolvedBank = (qrCodeRow?.bank as unknown as { id: string; name: string; is_active: boolean } | null) ?? null
        }

        if (!resolvedBank) {
            const { data: restaurantRow } = await supabase
                .from('restaurants')
                .select('qr_bank_account_id, qr_bank:bank_accounts!qr_bank_account_id(id, name, is_active)')
                .eq('id', restaurantId)
                .maybeSingle()
            resolvedBank = (restaurantRow?.qr_bank as unknown as { id: string; name: string; is_active: boolean } | null) ?? null
        }

        if (resolvedBank && resolvedBank.is_active) {
            bankAccountId = resolvedBank.id
            bankName = resolvedBank.name
        } else {
            const { data: defaultBank } = await supabase
                .from('bank_accounts')
                .select('id, name')
                .eq('restaurant_id', restaurantId)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()
            if (defaultBank) {
                bankAccountId = defaultBank.id
                bankName = defaultBank.name
            }
        }
    }

    const typeLabel = input.isAdvance ? 'Advance' : 'Settlement'
    const methodLabel = input.paymentMethod === 'cash' ? 'Cash' : 'QR/Digital'
    const desc = input.description || `Room ${typeLabel} (${methodLabel}): ${input.guestName} (Room ${input.roomNumber})`

    // 3. Create the Income Entry first
    const { error: incomeError } = await supabase
        .from('income_entries')
        .insert({
            restaurant_id: restaurantId,
            category_id: categoryId,
            amount: input.amount,
            description: desc,
            bank_account_id: bankAccountId,
            status: 'posted',
            created_by: userId || null
        })

    if (incomeError) {
        console.error('Failed to create room income entry:', incomeError)
        return { success: false, error: incomeError.message }
    }

    // 4. Try to write to the Day Book (only if an active session is open)
    const ledgerUser = { id: userId || '', restaurantId }
    const dayBookType = input.paymentMethod === 'cash' ? 'cash_in' : 'bank_in'
    const dayBookCategory = input.dayBookCategory ?? ((input.isAdvance ? 'room_deposit' : 'booking_payment') as DayBookEntryCategory)
 
    try {
        await postFinancialTransaction(supabase, ledgerUser, {
            type: dayBookType,
            amount: input.amount,
            description: desc,
            category: dayBookCategory,
            bankName: bankName,
            requireOpenSession: false
        })
    } catch (dbErr) {
        console.error('Failed to post room payment to day book:', dbErr)
    }

    return { success: true }
}

// Posts a staff-applied bargain rate (room or table bill) as a visible
// cost — mirrors postLoyaltyRedemptionExpense (api/loyalty/actions.ts). No
// cash actually left the business, so this intentionally never touches the
// Day Book; it exists purely so the discount shows up in Income & Expenses
// / the Finance Report instead of only living on the booking/session row.
// Shared by both hotel checkout and dine-in table checkout — one category
// for "money we chose not to collect" regardless of which side it's from.
export async function postBargainDiscountExpense(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string | null,
    input: { guestName: string; locationLabel: string; amount: number; reason: string }
): Promise<{ success: boolean; error?: string }> {
    if (input.amount <= 0) return { success: true }

    let categoryId: string | undefined
    const { data: existingCategory } = await supabase
        .from('expense_categories')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('name', 'Bargain Discounts')
        .maybeSingle()

    categoryId = existingCategory?.id
    if (!categoryId) {
        const { data: newCategory } = await supabase
            .from('expense_categories')
            .insert({ restaurant_id: restaurantId, name: 'Bargain Discounts' })
            .select('id')
            .single()
        categoryId = newCategory?.id
    }
    if (!categoryId) return { success: false, error: 'Failed to find/create Bargain Discounts category' }

    const { error } = await supabase.from('expenses').insert({
        restaurant_id: restaurantId,
        category_id: categoryId,
        amount: input.amount,
        description: `Bargain discount: ${input.reason} (${input.guestName}, ${input.locationLabel})`,
        status: 'paid',
        created_by: userId || null
    })

    if (error) {
        console.error('Failed to post bargain discount expense:', error)
        return { success: false, error: error.message }
    }
    return { success: true }
}
