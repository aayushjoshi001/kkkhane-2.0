'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { SupabaseClient } from '@supabase/supabase-js'
import { postFinancialTransaction, findOpenDayBookSessionId, resolveBankAccountId } from '@/lib/ledger'
import { getNstDateString } from '@/lib/timezone'
import { logAudit } from '@/lib/audit'

const PATH = '/admin/vouchers'

interface CurrentUserType {
    id: string
    restaurantId: string
}

async function requireManager(): Promise<CurrentUserType> {
    const user = await getCurrentUser()
    if (!user || !user.restaurantId) throw new Error('Unauthorized')
    return {
        id: user.id,
        restaurantId: user.restaurantId
    }
}

// Helper to post supplier ledger, staff payroll, or stock-purchase expense
// entries upon approval
// `dayBookEntryId` is stamped onto every record this creates so that deleting
// the voucher's Day Book entry cascades the downstream expense / staff_ledger
// row away with it instead of orphaning it.
async function postLedgerEntry(supabase: SupabaseClient, user: CurrentUserType, dayBookEntryId: string, voucher: {
    voucher_type: 'receipt' | 'payment'
    category?: 'suppliers' | 'staff' | 'expenses' | 'stock' | 'other'
    supplier_id?: string
    staff_user_id?: string
    expense_category_id?: string
    purchase_date?: string
    party_name: string
    amount: number
    particulars: string
    payment_mode: string
    bank_name?: string
}) {
    if (voucher.voucher_type !== 'payment') return // Only payments reduce outstanding balances

    if (voucher.category === 'stock') {
        let categoryId = voucher.expense_category_id
        if (!categoryId) {
            const { data: cat } = await supabase
                .from('expense_categories')
                .select('id')
                .eq('restaurant_id', user.restaurantId)
                .eq('name', 'Stock Purchases')
                .maybeSingle()

            categoryId = cat?.id
            if (!categoryId) {
                const { data: newCat } = await supabase
                    .from('expense_categories')
                    .insert({
                        restaurant_id: user.restaurantId,
                        name: 'Stock Purchases',
                        is_stock_category: true,
                        created_by: user.id
                    })
                    .select('id')
                    .single()
                categoryId = newCat?.id
            }
        }

        const bankAccountId = await resolveBankAccountId(supabase, user.restaurantId, voucher.bank_name)

        // Dated to when the purchase was originally recorded, not when a
        // cheque happens to get approved — so the expense always lands on
        // the day it was actually added.
        const { error: expenseErr } = await supabase
            .from('expenses')
            .insert({
                restaurant_id: user.restaurantId,
                category_id: categoryId,
                day_book_entry_id: dayBookEntryId,
                amount: voucher.amount,
                description: voucher.particulars,
                vendor_name: voucher.party_name,
                bank_account_id: bankAccountId,
                status: 'paid',
                created_by: user.id,
                ...(voucher.purchase_date ? { created_at: `${voucher.purchase_date}T12:00:00.000Z` } : {})
            })

        if (expenseErr) {
            console.error('Failed to post stock purchase expense:', expenseErr)
            throw new Error(`Failed to post expense: ${expenseErr.message}`)
        }
        return
    }

    if (voucher.category === 'suppliers' && voucher.supplier_id) {
        // Query the first available expense category
        const { data: cat } = await supabase
            .from('expense_categories')
            .select('id')
            .eq('restaurant_id', user.restaurantId)
            .limit(1)
            .maybeSingle()

        let categoryId = cat?.id
        if (!categoryId) {
            const { data: newCat } = await supabase
                .from('expense_categories')
                .insert({
                    restaurant_id: user.restaurantId,
                    name: 'Supplier Settlements',
                    created_by: user.id
                })
                .select('id')
                .single()
            categoryId = newCat?.id
        }

        const descJson = JSON.stringify({
            text_desc: `Payment Voucher: ${voucher.particulars}`,
            quantity: 1,
            rate: 0,
            unit: 'payment',
            paid_amount: voucher.amount,
            payment_type: voucher.payment_mode === 'cash' ? 'cash' : 'bank',
            bank_name: voucher.payment_mode !== 'cash' ? (voucher.bank_name || '') : ''
        })

        // Recorded like the stock branch does, so a spend-by-bank-account
        // report sees supplier settlements paid from a bank too.
        const bankAccountId = voucher.payment_mode !== 'cash'
            ? await resolveBankAccountId(supabase, user.restaurantId, voucher.bank_name)
            : null

        // Insert into expenses table with amount=0 and paid_amount=voucher.amount to offset balance
        const { error: expenseErr } = await supabase
            .from('expenses')
            .insert({
                restaurant_id: user.restaurantId,
                category_id: categoryId,
                day_book_entry_id: dayBookEntryId,
                amount: 0,
                description: descJson,
                vendor_name: voucher.party_name,
                bank_account_id: bankAccountId,
                status: 'paid',
                created_by: user.id
            })

        if (expenseErr) {
            console.error('Failed to post supplier settlement expense:', expenseErr)
            throw new Error(`Failed to post expense: ${expenseErr.message}`)
        }
    } else if (voucher.category === 'staff' && voucher.staff_user_id) {
        // Post payment to staff_ledger to reduce owed balance
        const paymentMethodVal = voucher.payment_mode === 'cash'
            ? 'cash'
            : (voucher.payment_mode === 'qr' ? 'qr_digital' : 'bank_transfer')

        const { error: insertErr } = await supabase
            .from('staff_ledger')
            .insert({
                restaurant_id: user.restaurantId,
                user_id: voucher.staff_user_id,
                day_book_entry_id: dayBookEntryId,
                amount: voucher.amount,
                entry_type: 'salary_payout',
                payment_method: paymentMethodVal,
                note: `Payment Voucher: ${voucher.particulars}`,
                created_by: user.id
            })

        if (insertErr) {
            console.error("Failed to post staff ledger entry:", insertErr)
            throw new Error(`Failed to post staff ledger: ${insertErr.message}`)
        }
    }
}

export async function createVoucherAction(input: {
    voucher_type: 'receipt' | 'payment'
    party_name: string
    amount: number
    payment_mode: 'cash' | 'qr' | 'cheque' | 'bank'
    bank_name?: string // Destination/Source Bank
    particulars: string
    reference_no?: string // Phone Number
    receiver_name?: string
    category?: 'suppliers' | 'staff' | 'expenses' | 'stock' | 'other'
    supplier_id?: string
    staff_user_id?: string
    expense_category_id?: string
    cheque_details?: {
        written_name: string
        bank_cheque: string // Issuer Bank
        cheque_number: string
        cheque_date: string
        cheque_type: 'ac_payee' | 'normal'
    }
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!input.party_name?.trim()) return { error: 'Party name is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.particulars?.trim()) return { error: 'Particulars description is required.' }
    if ((input.payment_mode === 'qr' || input.payment_mode === 'cheque' || input.payment_mode === 'bank') && !input.bank_name?.trim()) {
        return { error: 'Bank account is required.' }
    }

    const supabase = await createAdminClient()

    // ── Check if there is an active Day Book session open for today (in NST)
    const todayDateNst = getNstDateString()
    const openSessionId = await findOpenDayBookSessionId(supabase, user.restaurantId)

    if (!openSessionId) {
        return { error: 'No active Day Book session is open. Please open Cash Book or Bank Book to start a session first.' }
    }

    // Determine ownership type if Bank selected
    let isPersonalAccount = false
    let isAcPayeeAccount = false
    if ((input.payment_mode === 'qr' || input.payment_mode === 'cheque' || input.payment_mode === 'bank') && input.bank_name) {
        const { data: bankAcc } = await supabase
            .from('bank_accounts')
            .select('bank_name')
            .eq('restaurant_id', user.restaurantId)
            .ilike('name', input.bank_name.trim())
            .maybeSingle()
        if (bankAcc?.bank_name?.startsWith('personal:')) {
            isPersonalAccount = true
        } else if (bankAcc?.bank_name?.startsWith('company:') || bankAcc?.bank_name?.startsWith('ac_payee:')) {
            isAcPayeeAccount = true
        }
    }

    // ── Generate sequential Voucher Number
    // Drawn from an atomic per (restaurant, date, prefix) counter. Counting
    // existing rows instead would hand two simultaneous submissions the same
    // number, since both would read the same count before either inserted.
    const prefix = input.voucher_type === 'receipt' ? 'RV' : 'PV'

    const { data: sequence, error: sequenceError } = await supabase.rpc('next_voucher_number', {
        p_restaurant_id: user.restaurantId,
        p_date: todayDateNst,
        p_prefix: prefix
    })

    if (sequenceError || typeof sequence !== 'number') {
        return { error: `Failed to allocate a voucher number: ${sequenceError?.message ?? 'unknown error'}` }
    }

    const sequenceStr = String(sequence).padStart(3, '0')
    const dateCompact = todayDateNst.replace(/-/g, '').substring(2)
    const voucherNumber = `${prefix}-${dateCompact}-${sequenceStr}`

    // Cheque approval rules
    // Receipt normal cheque OR Payment personal cheque requires manager approval
    // If deposited to an A/C Payee account, it is approved immediately.
    // Stock purchase cheques always require approval before they hit the
    // bank ledger, regardless of account ownership type.
    const needsApproval = input.payment_mode === 'cheque' &&
        (input.category === 'stock'
            ? true
            : (input.voucher_type === 'receipt'
                ? (isAcPayeeAccount ? false : input.cheque_details?.cheque_type === 'normal')
                : isPersonalAccount))

    const status = needsApproval ? 'pending_approval' : 'approved'
    const dbAmount = needsApproval ? 0.01 : input.amount // Place 0.01 placeholder to hold record without altering active balances

    // ── Package Voucher details into JSON description
    const voucherDesc = JSON.stringify({
        voucher_type: input.voucher_type,
        voucher_number: voucherNumber,
        party_name: input.party_name.trim(),
        particulars: input.particulars.trim(),
        payment_mode: input.payment_mode,
        bank_name: (input.payment_mode !== 'cash' ? input.bank_name?.trim() : '') || '',
        reference_no: input.reference_no?.trim() || '',
        receiver_name: input.receiver_name?.trim() || '',
        status: status,
        amount: input.amount,
        category: input.category || 'other',
        supplier_id: input.supplier_id || '',
        staff_user_id: input.staff_user_id || '',
        expense_category_id: input.expense_category_id || '',
        purchase_date: todayDateNst,
        cheque_details: input.payment_mode === 'cheque' ? input.cheque_details : undefined
    })

    // Determine day book entry properties
    const dbType = input.voucher_type === 'receipt'
        ? (input.payment_mode === 'cash' ? 'cash_in' : 'bank_in')
        : (input.payment_mode === 'cash' ? 'cash_out' : 'bank_out')

    const dbCategory = input.voucher_type === 'receipt'
        ? (input.payment_mode === 'cash' ? 'other' : (input.payment_mode === 'qr' ? 'qr_payment' : 'deposit'))
        : (input.payment_mode === 'cash' ? 'expense' : 'transfer_out')

    const postResult = await postFinancialTransaction(supabase, user, {
        type: dbType,
        amount: dbAmount,
        description: voucherDesc,
        category: dbCategory,
        bankName: input.payment_mode !== 'cash' ? input.bank_name : null,
        requireOpenSession: true,
        selectClause: '*, day_book_sessions(date)'
    })

    if (postResult.error || !postResult.entry) return { error: postResult.error || 'Failed to post voucher entry.' }
    const newEntry = postResult.entry

    // If approved immediately, post ledger impacts. A voucher whose ledger
    // impact failed to post is worse than no voucher at all — it shows as paid
    // while the supplier/staff balance is untouched — so undo the entry.
    if (status === 'approved') {
        try {
            await postLedgerEntry(supabase, user, newEntry.id, {
                voucher_type: input.voucher_type,
                category: input.category,
                supplier_id: input.supplier_id,
                staff_user_id: input.staff_user_id,
                expense_category_id: input.expense_category_id,
                purchase_date: todayDateNst,
                party_name: input.party_name,
                amount: input.amount,
                particulars: input.particulars,
                payment_mode: input.payment_mode,
                bank_name: input.bank_name
            })
        } catch (e) {
            await supabase.from('day_book_entries').delete().eq('id', newEntry.id)
            return { error: e instanceof Error ? e.message : 'Failed to post voucher ledger entry.' }
        }
    }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')

    return { data: newEntry }
}

export async function approveChequeAction(id: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    // Fetch the target voucher entry
    const { data: entry, error: fetchError } = await supabase
        .from('day_book_entries')
        .select('*')
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchError || !entry) return { error: 'Voucher entry not found.' }

    try {
        const parsed = JSON.parse(entry.description)
        if (parsed.status !== 'pending_approval') {
            return { error: 'This cheque is not pending approval.' }
        }

        // Update values
        parsed.status = 'approved'
        const updatedDesc = JSON.stringify(parsed)

        const { error: updateError } = await supabase
            .from('day_book_entries')
            .update({
                amount: parsed.amount, // Set the real amount!
                description: updatedDesc
            })
            .eq('id', id)

        if (updateError) return { error: updateError.message }

        // Post ledger impacts now that it is approved. If that fails, put the
        // cheque back to pending rather than leaving it marked approved with
        // no ledger impact — and surface the real reason, since the enclosing
        // catch would otherwise blame the description format.
        try {
            await postLedgerEntry(supabase, user, id, {
                voucher_type: parsed.voucher_type,
                category: parsed.category,
                supplier_id: parsed.supplier_id,
                staff_user_id: parsed.staff_user_id,
                expense_category_id: parsed.expense_category_id,
                purchase_date: parsed.purchase_date,
                party_name: parsed.party_name,
                amount: parsed.amount,
                particulars: parsed.particulars,
                payment_mode: parsed.payment_mode,
                bank_name: parsed.bank_name
            })
        } catch (e) {
            await supabase
                .from('day_book_entries')
                .update({ amount: 0.01, description: entry.description })
                .eq('id', id)
            return { error: e instanceof Error ? e.message : 'Failed to post voucher ledger entry.' }
        }

        revalidatePath(PATH)
        revalidatePath('/admin/cash-book')
        revalidatePath('/admin/bank-book')
        revalidatePath('/admin/bank-ledger')

        return { success: true }
    } catch {
        return { error: 'Invalid voucher description format.' }
    }
}

export async function rejectChequeAction(id: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const { data: entry, error: fetchError } = await supabase
        .from('day_book_entries')
        .select('*')
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchError || !entry) return { error: 'Voucher entry not found.' }

    try {
        const parsed = JSON.parse(entry.description)
        parsed.status = 'rejected'
        const updatedDesc = JSON.stringify(parsed)

        const { error: updateError } = await supabase
            .from('day_book_entries')
            .update({
                amount: 0.01,
                description: updatedDesc
            })
            .eq('id', id)

        if (updateError) return { error: updateError.message }

        revalidatePath(PATH)
        revalidatePath('/admin/cash-book')
        revalidatePath('/admin/bank-book')
        revalidatePath('/admin/bank-ledger')

        return { success: true }
    } catch {
        return { error: 'Invalid voucher description format.' }
    }
}

export async function deleteVoucherAction(id: string, reason: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!reason.trim()) return { error: 'A reason is required to delete a voucher.' }

    const supabase = await createAdminClient()

    // Snapshot what's about to be destroyed before it's gone, so the audit
    // trail actually shows what this voucher was, not just that "something"
    // was deleted.
    const { data: existing } = await supabase
        .from('day_book_entries')
        .select('type, amount, description, category, bank_name')
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
        .maybeSingle()

    if (!existing) return { error: 'Voucher not found.' }

    // The expenses / staff_ledger row this voucher created (if it was
    // approved) goes with it via day_book_entry_id's ON DELETE CASCADE.
    const { error, count } = await supabase
        .from('day_book_entries')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)

    if (error) return { error: error.message }
    if (!count) return { error: 'Voucher not found.' }

    void logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: 'voucher_deleted',
        entityType: 'day_book_entry',
        entityId: id,
        oldValue: { ...existing, reason },
    })

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')

    return { success: true }
}

export async function openTodayDayBookSessionAction() {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const todayDateNst = getNstDateString()

    // Calculate opening balances from last closed session
    const { data: lastSession } = await supabase
        .from('day_book_sessions')
        .select('id, opening_balance, opening_bank_balance')
        .eq('restaurant_id', user.restaurantId)
        .eq('status', 'closed')
        .lt('date', todayDateNst)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    let openingBalance = 0
    let openingBankBalance = 0

    if (lastSession) {
        const { data: totals } = await supabase
            .from('day_book_entries')
            .select('type, amount')
            .eq('session_id', lastSession.id)

        const cashIn = (totals ?? [])
            .filter((e) => e.type === 'cash_in')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        const cashOut = (totals ?? [])
            .filter((e) => e.type === 'cash_out')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        openingBalance = Number(lastSession.opening_balance) + cashIn - cashOut
        if (openingBalance < 0) openingBalance = 0

        const bankIn = (totals ?? [])
            .filter((e) => e.type === 'bank_in')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        const bankOut = (totals ?? [])
            .filter((e) => e.type === 'bank_out')
            .reduce((sum, e) => sum + Number(e.amount), 0)

        openingBankBalance = Number(lastSession.opening_bank_balance ?? 0) + bankIn - bankOut
        if (openingBankBalance < 0) openingBankBalance = 0
    }

    const { data: session, error } = await supabase
        .from('day_book_sessions')
        .insert({
            restaurant_id: user.restaurantId,
            date: todayDateNst,
            opening_balance: openingBalance,
            opening_bank_balance: openingBankBalance,
            status: 'open',
            created_by: user.id
        })
        .select()
        .single()

    if (error) return { error: error.message }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')

    return { data: session }
}
