// Shared "did money move" engine for the Resources section. Every module
// that touches the Day Book (Vouchers, Suppliers, Staff, Income & Expenses,
// Cash Book) used to check for an open session and insert a day_book_entries
// row with its own copy-pasted logic — this centralizes that so all of them
// stay correlated (same session lookup, same bank-account resolution, same
// row shape) instead of drifting apart.

import { SupabaseClient } from '@supabase/supabase-js'
import { getNstDateString } from './timezone'
import { DayBookEntry, DayBookEntryCategory, DayBookEntryType } from '@/types/database'

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
}

export interface PostFinancialTransactionResult {
    posted: boolean
    sessionId?: string
    bankAccountId?: string | null
    entry?: DayBookEntry & Record<string, unknown>
    error?: string
}

export async function findOpenDayBookSessionId(
    supabase: SupabaseClient,
    restaurantId: string
): Promise<string | undefined> {
    const todayDateNst = getNstDateString()
    const { data } = await supabase
        .from('day_book_sessions')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('date', todayDateNst)
        .eq('status', 'open')
        .maybeSingle()
    return data?.id
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
    const sessionId = await findOpenDayBookSessionId(supabase, user.restaurantId)

    if (!sessionId) {
        if (input.requireOpenSession) {
            return { posted: false, error: 'No active Day Book session is open. Please open Cash Book or Bank Book to start a session first.' }
        }
        return { posted: false }
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
            created_by: user.id
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
        bookingId: string
        roomNumber: string
        guestName: string
        amount: number
        paymentMethod: 'cash' | 'qr_digital' | 'card'
        isAdvance: boolean
    }
): Promise<{ success: boolean; error?: string }> {
    if (input.amount <= 0) return { success: true }

    // 1. Find or create the 'Room Revenue' category
    let categoryId: string | undefined
    const { data: existingCategory } = await supabase
        .from('income_categories')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('name', 'Room Revenue')
        .maybeSingle()

    categoryId = existingCategory?.id
    if (!categoryId) {
        const { data: newCategory } = await supabase
            .from('income_categories')
            .insert({ restaurant_id: restaurantId, name: 'Room Revenue' })
            .select('id')
            .single()
        categoryId = newCategory?.id
    }
    if (!categoryId) return { success: false, error: 'Failed to find/create Room Revenue category' }

    // 2. Resolve bank account ID if QR or card
    let bankAccountId: string | null = null
    let bankName: string | null = null
    if (input.paymentMethod === 'qr_digital' || input.paymentMethod === 'card') {
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

    const typeLabel = input.isAdvance ? 'Advance' : 'Settlement'
    const methodLabel = input.paymentMethod === 'cash' ? 'Cash' : 'QR/Digital'
    const desc = `Room ${typeLabel} (${methodLabel}): ${input.guestName} (Room ${input.roomNumber})`

    // 3. Create the Income Entry first
    const { error: incomeError } = await supabase
        .from('income_entries')
        .insert({
            restaurant_id: restaurantId,
            category_id: categoryId,
            amount: input.amount,
            description: desc,
            bank_account_id: bankAccountId,
            status: 'paid',
            created_by: userId || null
        })

    if (incomeError) {
        console.error('Failed to create room income entry:', incomeError)
        return { success: false, error: incomeError.message }
    }

    // 4. Try to write to the Day Book (only if an active session is open)
    const ledgerUser = { id: userId || '', restaurantId }
    const dayBookType = input.paymentMethod === 'cash' ? 'cash_in' : 'bank_in'
    const dayBookCategory = (input.isAdvance ? 'room_deposit' : 'booking_payment') as DayBookEntryCategory
 
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
