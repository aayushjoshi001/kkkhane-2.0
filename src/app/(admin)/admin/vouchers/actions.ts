'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { SupabaseClient } from '@supabase/supabase-js'
import { postFinancialTransaction, findOpenDayBookSessionId, resolveBankAccountId, resolveActiveDayBookSession } from '@/lib/ledger'
import { getNstDateString } from '@/lib/timezone'
import { logAudit } from '@/lib/audit'
import {
    fetchOutstandingSupplierBills, sumOwed, computeFifoAllocations,
    applySupplierFifoAllocations, reverseSupplierFifoAllocations,
} from '@/lib/supplierSettlement'
import { fetchStaffCurrentDue, STAFF_PAY_ENTRY_TYPES, type StaffLedgerEntryType } from '@/lib/staffLedger'

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

interface PostLedgerEntryResult {
    settledBills?: Array<{ id: string; paid_amount: number }>
}

// Helper to post supplier ledger, staff payroll, or stock-purchase expense
// entries upon approval
// `dayBookEntryId` is stamped onto every record this creates so that deleting
// the voucher's Day Book entry cascades the downstream expense / staff_ledger
// row away with it instead of orphaning it. Suppliers are the one exception —
// see the FIFO settlement branch below, which mutates *existing* bill rows
// instead of creating a new cascade-linked one, and relies on
// voucher_supplier_settlements for reversibility instead.
async function postLedgerEntry(supabase: SupabaseClient, user: CurrentUserType, dayBookEntryId: string, voucher: {
    voucher_type: 'receipt' | 'payment'
    category?: 'suppliers' | 'staff' | 'expenses' | 'stock' | 'other'
    supplier_id?: string
    staff_user_id?: string
    staff_entry_type?: StaffLedgerEntryType
    expense_category_id?: string
    purchase_date?: string
    party_name: string
    amount: number
    particulars: string
    payment_mode: string
    bank_name?: string
}): Promise<PostLedgerEntryResult> {
    if (voucher.voucher_type !== 'payment') return {} // Only payments reduce outstanding balances

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
        return {}
    }

    if (voucher.category === 'suppliers' && voucher.supplier_id) {
        // Never trust the client-supplied party_name for bill-matching —
        // resolve the real supplier name server-side from the id. Bills
        // aren't linked to suppliers by FK (expenses has no supplier_id
        // column), only by vendor_name string equality.
        const { data: supplier } = await supabase
            .from('suppliers')
            .select('name')
            .eq('id', voucher.supplier_id)
            .eq('restaurant_id', user.restaurantId)
            .maybeSingle()

        if (!supplier) throw new Error('Supplier not found.')

        const outstandingBills = await fetchOutstandingSupplierBills(supabase, user.restaurantId, supplier.name)
        const totalOwed = sumOwed(outstandingBills)

        // A supplier with nothing outstanding can still be paid in advance —
        // the day_book_entries row this voucher already posted fully
        // documents the cash movement; there's simply no bill to settle.
        if (totalOwed > 0.01) {
            if (voucher.amount > totalOwed + 0.01) {
                throw new Error(`Amount exceeds this supplier's total outstanding balance (Rs. ${totalOwed.toFixed(2)}).`)
            }

            const allocations = computeFifoAllocations(outstandingBills, voucher.amount)
            const applyResult = await applySupplierFifoAllocations(supabase, {
                restaurantId: user.restaurantId,
                dayBookEntryId,
                paymentMode: voucher.payment_mode,
                bankName: voucher.bank_name,
                allocations,
            })

            if (applyResult.error) {
                console.error('Failed to settle supplier bills:', applyResult.error)
                throw new Error(`Failed to settle outstanding bills: ${applyResult.error}`)
            }

            return { settledBills: allocations.map(a => ({ id: a.bill.id, paid_amount: a.newPaidAmount })) }
        }

        return {}
    } else if (voucher.category === 'staff' && voucher.staff_user_id) {
        const entryType: StaffLedgerEntryType = voucher.staff_entry_type || 'salary_payout'

        // Only a straightforward salary payout is capped at what's actually
        // owed — an advance is by definition paid before it's due, and a
        // bonus is discretionary, so neither should be blocked by "due".
        if (entryType === 'salary_payout') {
            const currentDue = await fetchStaffCurrentDue(supabase, user.restaurantId, voucher.staff_user_id)
            if (currentDue <= 0.01) {
                throw new Error('This staff member has no outstanding due — use Advance Payment or Bonus instead.')
            }
            if (voucher.amount > currentDue + 0.01) {
                throw new Error(`Amount exceeds this staff member's current due (Rs. ${currentDue.toFixed(2)}).`)
            }
        }

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
                entry_type: entryType,
                payment_method: paymentMethodVal,
                note: `Payment Voucher: ${voucher.particulars}`,
                created_by: user.id
            })

        if (insertErr) {
            console.error("Failed to post staff ledger entry:", insertErr)
            throw new Error(`Failed to post staff ledger: ${insertErr.message}`)
        }
    }

    return {}
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
    staff_entry_type?: StaffLedgerEntryType
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
    if (input.staff_entry_type && !STAFF_PAY_ENTRY_TYPES.includes(input.staff_entry_type)) {
        return { error: 'Invalid staff pay category.' }
    }
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
        staff_entry_type: input.category === 'staff' ? (input.staff_entry_type || 'salary_payout') : undefined,
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
        selectClause: '*, day_book_sessions(date)',
        referenceId: input.category === 'suppliers' ? input.supplier_id 
                   : input.category === 'staff' ? input.staff_user_id 
                   : input.category === 'expenses' ? input.expense_category_id 
                   : input.category === 'stock' ? input.expense_category_id 
                   : null
    })

    if (postResult.error || !postResult.entry) return { error: postResult.error || 'Failed to post voucher entry.' }
    const newEntry = postResult.entry

    // If approved immediately, post ledger impacts. A voucher whose ledger
    // impact failed to post is worse than no voucher at all — it shows as paid
    // while the supplier/staff balance is untouched — so undo the entry.
    let ledgerResult: PostLedgerEntryResult = {}
    if (status === 'approved') {
        try {
            ledgerResult = await postLedgerEntry(supabase, user, newEntry.id, {
                voucher_type: input.voucher_type,
                category: input.category,
                supplier_id: input.supplier_id,
                staff_user_id: input.staff_user_id,
                staff_entry_type: input.staff_entry_type,
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
    revalidatePath('/admin/suppliers')
    revalidatePath('/admin/staff')

    return { data: newEntry, settledBills: ledgerResult.settledBills }
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
                staff_entry_type: parsed.staff_entry_type,
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
        revalidatePath('/admin/suppliers')
        revalidatePath('/admin/staff')

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

    // A supplier settlement mutates existing bill rows in place rather than
    // creating a new cascade-linked one (those bills' day_book_entry_id stays
    // NULL by design), so it has to be unwound explicitly before the delete —
    // otherwise the cascade below leaves those bills over-reported as paid.
    await reverseSupplierFifoAllocations(supabase, id)

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
    revalidatePath('/admin/suppliers')
    revalidatePath('/admin/staff')

    return { success: true }
}

export async function openTodayDayBookSessionAction() {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    // Reuses the same resolver Cash Book/Bank Book use: returns the already-
    // open session if one exists, or auto-opens the next one carrying
    // forward the last closed session's balances.
    let session = await resolveActiveDayBookSession(supabase, user.restaurantId, user.id)

    if (!session) {
        // True first-ever use — nothing to carry forward, start at zero.
        const { data: newSession, error } = await supabase
            .from('day_book_sessions')
            .insert({
                restaurant_id: user.restaurantId,
                date: getNstDateString(),
                opening_balance: 0,
                opening_bank_balance: 0,
                status: 'open',
                created_by: user.id,
            })
            .select()
            .single()

        if (error) return { error: error.message }
        session = newSession
    }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')

    return { data: session }
}
