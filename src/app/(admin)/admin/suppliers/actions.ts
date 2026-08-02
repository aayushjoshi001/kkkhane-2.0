'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { postFinancialTransaction, resolveBankAccountId } from '@/lib/ledger'
import { SupabaseClient } from '@supabase/supabase-js'
import { UNSPECIFIED_SUPPLIER_NAME, type SupplierPaymentSource } from '@/components/admin/SupplierPaymentFields'

async function requireManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/suppliers'

interface SupplierPaymentPostInput {
    payment_source: SupplierPaymentSource
    amount: number
    bank_name?: string
    cash_portion?: number
    qr_portion?: number
}

interface ChequeDetailsInput {
    written_name: string
    bank_cheque: string
    cheque_number: string
    cheque_date: string
    cheque_type: 'ac_payee' | 'normal'
}

function validateChequeDetailsInput(v?: ChequeDetailsInput): string | null {
    if (!v?.written_name?.trim()) return 'Cheque written name is required.'
    if (!v.bank_cheque?.trim()) return 'Issuer bank is required.'
    if (!v.cheque_number?.trim()) return 'Cheque number is required.'
    if (!v.cheque_date?.trim()) return 'Cheque date is required.'
    return null
}

// A parsed expenses.description JSON — every field the bill's packed
// description may carry, cheque-pending fields included.
interface ParsedBillDescription {
    text_desc?: string
    quantity?: number
    rate?: number
    unit?: string
    paid_amount?: number
    payment_type?: string
    bank_name?: string
    bill_number?: string
    cash_portion?: number
    qr_portion?: number
    cheque_status?: 'pending_approval' | 'approved' | 'rejected'
    cheque_details?: ChequeDetailsInput
    pending_cheque?: { amount: number; bank_name: string; cheque_details: ChequeDetailsInput }
}

function parseBillDescription(description: string | null): ParsedBillDescription {
    try {
        if (description?.startsWith('{')) return JSON.parse(description)
    } catch { /* fall through */ }
    return {}
}

function validateSupplierPaymentSource(input: {
    payment_source: SupplierPaymentSource
    paid_amount: number
    bank_name?: string
    cash_portion?: number
    qr_portion?: number
}): string | null {
    if (input.paid_amount <= 0) return null
    if ((input.payment_source === 'qr' || input.payment_source === 'cheque') && !input.bank_name?.trim()) {
        return 'Bank account is required for this payment method.'
    }
    if (input.payment_source === 'cash_qr') {
        if (!input.bank_name?.trim()) return 'Bank account is required for the QR portion.'
        const sum = (input.cash_portion ?? 0) + (input.qr_portion ?? 0)
        if (Math.abs(sum - input.paid_amount) > 0.01) return 'Cash + QR amounts must add up to the amount paid.'
    }
    return null
}

// Posts a supplier payment to the Day Book — one entry for cash/qr/cheque, or
// two (cash_out + bank_out) for a cash+QR split, mirroring the split
// hotel-booking advance payment pattern so each method lands in the correct
// cash-in-hand / bank ledger instead of one lump sum under a single method.
async function postSupplierPayment(
    supabase: SupabaseClient,
    user: { id: string; restaurantId: string },
    input: SupplierPaymentPostInput,
    description: string
): Promise<{ error?: string }> {
    if (input.amount <= 0) return {}

    if (input.payment_source === 'cash') {
        const r = await postFinancialTransaction(supabase, user, {
            type: 'cash_out', amount: input.amount, description, category: 'expense', bankName: null
        })
        return { error: r.error }
    }

    if (input.payment_source === 'qr' || input.payment_source === 'cheque') {
        const r = await postFinancialTransaction(supabase, user, {
            type: 'bank_out', amount: input.amount, description, category: 'transfer_out', bankName: input.bank_name
        })
        return { error: r.error }
    }

    // cash_qr split — two Day Book entries for one payment.
    const errors: string[] = []
    const cashPortion = input.cash_portion ?? 0
    const qrPortion = input.qr_portion ?? 0
    if (cashPortion > 0) {
        const r = await postFinancialTransaction(supabase, user, {
            type: 'cash_out', amount: cashPortion, description, category: 'expense', bankName: null
        })
        if (r.error) errors.push(r.error)
    }
    if (qrPortion > 0) {
        const r = await postFinancialTransaction(supabase, user, {
            type: 'bank_out', amount: qrPortion, description, category: 'transfer_out', bankName: input.bank_name
        })
        if (r.error) errors.push(r.error)
    }
    return errors.length ? { error: errors.join('; ') } : {}
}

export async function createSupplierAction(input: {
    name: string
    phone: string
    pan?: string
    vat?: string
    address?: string
    category_id?: string | null
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const name = input.name?.trim()
    const phone = input.phone?.trim()
    if (!name) return { error: 'Supplier Name is required.' }
    if (!phone) return { error: 'Phone Number is required.' }

    const supabase = await createAdminClient()

    // Store PAN and VAT as a JSON string in contact_person
    const panVatJson = JSON.stringify({
        pan: input.pan?.trim() || '',
        vat: input.vat?.trim() || ''
    })

    const { data, error } = await supabase
        .from('suppliers')
        .insert({
            restaurant_id: user.restaurantId,
            name,
            phone,
            address: input.address?.trim() || null,
            contact_person: panVatJson, // Store PAN & VAT
            category_id: input.category_id || null,
            is_active: true,
            created_by: user.id
        })
        .select()
        .single()

    if (error) {
        if (error.code === '23505') {
            return { error: 'A supplier with this name already exists.' }
        }
        return { error: error.message }
    }

    revalidatePath(PATH)
    return { data }
}

export async function updateSupplierAction(id: string, input: {
    name: string
    phone: string
    pan?: string
    vat?: string
    address?: string
    category_id?: string | null
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const name = input.name?.trim()
    const phone = input.phone?.trim()
    if (!name) return { error: 'Supplier Name is required.' }
    if (!phone) return { error: 'Phone Number is required.' }

    const supabase = await createAdminClient()

    const panVatJson = JSON.stringify({
        pan: input.pan?.trim() || '',
        vat: input.vat?.trim() || ''
    })

    const { data, error } = await supabase
        .from('suppliers')
        .update({
            name,
            phone,
            address: input.address?.trim() || null,
            contact_person: panVatJson,
            category_id: input.category_id || null,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
        .select()
        .single()

    if (error) return { error: error.message }

    revalidatePath(PATH)
    return { data }
}

export async function deleteSupplierAction(id: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const { error, count } = await supabase
        .from('suppliers')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)

    if (error) return { error: error.message }
    if (!count) return { error: 'Supplier not found.' }

    revalidatePath(PATH)
    return { success: true }
}

export async function createSupplierBillAction(input: {
    supplier_name?: string
    category_id: string
    text_desc: string
    quantity: number
    rate: number
    unit: string
    amount: number
    paid_amount: number
    payment_source: SupplierPaymentSource
    bank_name?: string
    cash_portion?: number
    qr_portion?: number
    cheque_details?: ChequeDetailsInput
    ingredient_id?: string
    // The supplier's own invoice/bill reference number — optional, purely
    // for cross-checking against their paperwork later.
    bill_number?: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    // Naming a supplier is optional — a manager may just want to log a
    // purchase's total/payment/due for their own records without registering
    // a formal supplier. Falls back to a shared placeholder vendor name.
    const supplierName = input.supplier_name?.trim() || UNSPECIFIED_SUPPLIER_NAME
    if (!input.category_id) return { error: 'Category is required.' }
    if (!input.text_desc?.trim()) return { error: 'Description is required.' }
    if (input.quantity <= 0) return { error: 'Quantity must be positive.' }
    if (input.rate <= 0) return { error: 'Rate must be positive.' }
    if (input.paid_amount < 0) return { error: 'Paid amount cannot be negative.' }
    if (input.paid_amount > input.amount) return { error: 'Paid amount cannot exceed total amount.' }

    const validationError = validateSupplierPaymentSource({
        payment_source: input.payment_source,
        paid_amount: input.paid_amount,
        bank_name: input.bank_name,
        cash_portion: input.cash_portion,
        qr_portion: input.qr_portion,
    })
    if (validationError) return { error: validationError }

    // A cheque payment is held pending manager approval — the bill itself is
    // recorded now (goods were received), but the payment portion doesn't
    // touch the Day Book or reduce the due balance until approved.
    const needsApproval = input.payment_source === 'cheque' && input.paid_amount > 0
    if (needsApproval) {
        const chequeError = validateChequeDetailsInput(input.cheque_details)
        if (chequeError) return { error: chequeError }
    }

    const supabase = await createAdminClient()

    // 1. Pack items into description JSON. paid_amount === 0 means fully on
    // credit — the bill still gets created, just with nothing posted below.
    // A pending cheque also leaves paid_amount at 0 (nothing's confirmed to
    // have moved yet) with the real amount/details parked under pending_cheque
    // until an approval action resolves it one way or the other.
    const descJson = JSON.stringify({
        text_desc: input.text_desc.trim(),
        quantity: input.quantity,
        rate: input.rate,
        unit: input.unit || 'pcs',
        paid_amount: needsApproval ? 0 : input.paid_amount,
        payment_type: input.payment_source,
        bank_name: input.payment_source !== 'cash' ? (input.bank_name?.trim() || '') : '',
        bill_number: input.bill_number?.trim() || '',
        ...(input.payment_source === 'cash_qr' ? { cash_portion: input.cash_portion ?? 0, qr_portion: input.qr_portion ?? 0 } : {}),
        ...(needsApproval ? {
            cheque_status: 'pending_approval',
            pending_cheque: {
                amount: input.paid_amount,
                bank_name: input.bank_name?.trim() || '',
                cheque_details: input.cheque_details,
            },
        } : {}),
    })

    const bankAccountId = input.payment_source !== 'cash'
        ? await resolveBankAccountId(supabase, user.restaurantId, input.bank_name)
        : null

    // 2. Insert into expenses table
    const { data: newExpense, error: expError } = await supabase
        .from('expenses')
        .insert({
            restaurant_id: user.restaurantId,
            category_id: input.category_id,
            amount: input.amount,
            description: descJson,
            vendor_name: supplierName,
            status: 'paid',
            bank_account_id: bankAccountId,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
            created_by: user.id
        })
        .select('*, expense_categories(*), bank_accounts(*)')
        .single()

    if (expError) return { error: expError.message }

    // 2b. Automatically log stock movement if an ingredient is linked to the purchase
    if (input.ingredient_id && newExpense) {
        const { error: moveErr } = await supabase
            .from('ingredient_movements')
            .insert({
                ingredient_id: input.ingredient_id,
                movement_type: 'purchase',
                quantity: input.quantity,
                reference_id: newExpense.id,
                notes: `Purchase from supplier: ${supplierName}`,
                performed_by: user.id
            })

        if (!moveErr) {
            await supabase.rpc('adjust_ingredient_stock', {
                p_ingredient_id: input.ingredient_id,
                p_delta: input.quantity
            })
        } else {
            console.error('Failed to record stock movement:', moveErr)
        }
    }

    // 3. Post paid_amount to Day Book if greater than 0 and not held for
    // cheque approval. The difference between amount and paid_amount is the
    // due/outstanding balance shown in the Suppliers Ledger — the bill itself
    // is already saved, so a failed Day Book posting is reported as a warning
    // rather than failing the whole action, but it must never pass silently.
    let warning: string | undefined
    if (input.paid_amount > 0 && !needsApproval) {
        const postResult = await postSupplierPayment(supabase, user, {
            payment_source: input.payment_source,
            amount: input.paid_amount,
            bank_name: input.bank_name,
            cash_portion: input.cash_portion,
            qr_portion: input.qr_portion,
        }, `[Supplier Bill Paid] ${input.text_desc.trim()} (Supplier: ${supplierName})`)

        if (postResult.error) {
            console.error('Failed to post supplier payment to Day Book:', postResult.error)
            warning = `Bill saved, but it could not be posted to the Day Book: ${postResult.error}`
        }
    }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/income-expenses')

    return { data: newExpense, warning, pendingApproval: needsApproval }
}

/**
 * Records a follow-up payment against a bill created earlier (e.g. goods
 * bought on credit, paid off days later). The expense itself keeps its
 * original date — it represents when the goods were bought, not when they
 * were paid for — only the day book/cash-bank ledger entry is dated today,
 * for the amount actually changing hands right now.
 */
export async function paySupplierBillAction(input: {
    expense_id: string
    amount: number
    payment_source: SupplierPaymentSource
    bank_name?: string
    cash_portion?: number
    qr_portion?: number
    cheque_details?: ChequeDetailsInput
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (input.amount <= 0) return { error: 'Payment amount must be positive.' }

    const validationError = validateSupplierPaymentSource({
        payment_source: input.payment_source,
        paid_amount: input.amount,
        bank_name: input.bank_name,
        cash_portion: input.cash_portion,
        qr_portion: input.qr_portion,
    })
    if (validationError) return { error: validationError }

    const needsApproval = input.payment_source === 'cheque'
    if (needsApproval) {
        const chequeError = validateChequeDetailsInput(input.cheque_details)
        if (chequeError) return { error: chequeError }
    }

    const supabase = await createAdminClient()

    const { data: expense, error: fetchError } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', input.expense_id)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchError || !expense) return { error: 'Bill not found.' }

    const parsed = parseBillDescription(expense.description)

    // A pending cheque already claims part of what's "owed" — block a second
    // payment attempt on top of it until a manager approves or rejects it,
    // otherwise the bill could get double-paid.
    if (parsed.cheque_status === 'pending_approval') {
        return { error: 'This bill has a cheque payment pending manager approval — resolve it before recording another payment.' }
    }

    const totalAmount = Number(expense.amount)
    const alreadyPaid = Number(parsed.paid_amount ?? totalAmount)
    const owed = totalAmount - alreadyPaid
    if (owed <= 0) return { error: 'This bill is already fully paid.' }
    if (input.amount > owed) return { error: `Payment cannot exceed the outstanding balance (Rs. ${owed.toFixed(2)}).` }

    // A cheque payment is held pending approval — paid_amount doesn't move
    // and nothing posts to the Day Book until it's approved.
    const updatedDescJson = JSON.stringify({
        ...parsed,
        paid_amount: needsApproval ? alreadyPaid : alreadyPaid + input.amount,
        // Keep the method that most recently touched the bill, so the
        // ledger's "Payment Type" column reflects the latest payment.
        payment_type: input.payment_source,
        bank_name: input.payment_source !== 'cash' ? (input.bank_name?.trim() || '') : '',
        ...(input.payment_source === 'cash_qr' ? { cash_portion: input.cash_portion ?? 0, qr_portion: input.qr_portion ?? 0 } : {}),
        ...(needsApproval ? {
            cheque_status: 'pending_approval',
            pending_cheque: {
                amount: input.amount,
                bank_name: input.bank_name?.trim() || '',
                cheque_details: input.cheque_details,
            },
        } : {}),
    })

    const { error: updateError } = await supabase
        .from('expenses')
        .update({ description: updatedDescJson })
        .eq('id', input.expense_id)
        .eq('restaurant_id', user.restaurantId)

    if (updateError) return { error: updateError.message }

    let warning: string | undefined
    if (!needsApproval) {
        const postResult = await postSupplierPayment(supabase, user, {
            payment_source: input.payment_source,
            amount: input.amount,
            bank_name: input.bank_name,
            cash_portion: input.cash_portion,
            qr_portion: input.qr_portion,
        }, `[Bill Payment] ${parsed.text_desc || expense.description} (Supplier: ${expense.vendor_name})`)

        if (postResult.error) {
            console.error('Failed to post supplier bill payment to Day Book:', postResult.error)
            warning = `Payment saved, but it could not be posted to the Day Book: ${postResult.error}`
        }
    }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/income-expenses')

    return { success: true, warning, pendingApproval: needsApproval }
}

/**
 * Lists every supplier bill currently holding a cheque payment pending
 * manager approval — the queue a manager works through to approve/reject.
 */
export async function getPendingChequeBillsAction() {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    // The pending status lives inside the packed description JSON (expenses
    // has no dedicated status column for this) — match it as text, same
    // approach vouchers/actions.ts uses for pending_approval day book entries.
    const { data, error } = await supabase
        .from('expenses')
        .select('*, expense_categories(*)')
        .eq('restaurant_id', user.restaurantId)
        .ilike('description', '%"cheque_status":"pending_approval"%')
        .order('created_at', { ascending: false })

    if (error) return { error: error.message }
    return { data: data || [] }
}

/**
 * Approves a bill's pending cheque — moves paid_amount up by the held amount
 * and posts the real payment to the Day Book for the first time (dated now,
 * not backdated to when the cheque was recorded).
 */
export async function approveChequeBillAction(expenseId: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const { data: expense, error: fetchError } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', expenseId)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchError || !expense) return { error: 'Bill not found.' }

    const parsed = parseBillDescription(expense.description)
    if (parsed.cheque_status !== 'pending_approval' || !parsed.pending_cheque) {
        return { error: 'This bill has no pending cheque to approve.' }
    }

    const pending = parsed.pending_cheque
    const newPaidAmount = Number(parsed.paid_amount ?? 0) + Number(pending.amount)

    const updatedDescJson = JSON.stringify({
        ...parsed,
        paid_amount: newPaidAmount,
        payment_type: 'cheque',
        bank_name: pending.bank_name,
        cheque_status: 'approved',
        cheque_details: pending.cheque_details,
        pending_cheque: undefined,
    })

    const { error: updateError } = await supabase
        .from('expenses')
        .update({ description: updatedDescJson })
        .eq('id', expenseId)
        .eq('restaurant_id', user.restaurantId)

    if (updateError) return { error: updateError.message }

    const postResult = await postSupplierPayment(supabase, user, {
        payment_source: 'cheque',
        amount: pending.amount,
        bank_name: pending.bank_name,
    }, `[Cheque Approved] ${parsed.text_desc || expense.description} (Supplier: ${expense.vendor_name})`)

    let warning: string | undefined
    if (postResult.error) {
        console.error('Failed to post approved cheque to Day Book:', postResult.error)
        warning = `Cheque approved, but it could not be posted to the Day Book: ${postResult.error}`
    }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/income-expenses')

    return { success: true, warning }
}

/**
 * Rejects a bill's pending cheque — paid_amount stays exactly where it was
 * (the bill remains due for that portion), nothing is ever posted to the
 * Day Book for a rejected cheque.
 */
export async function rejectChequeBillAction(expenseId: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const { data: expense, error: fetchError } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', expenseId)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchError || !expense) return { error: 'Bill not found.' }

    const parsed = parseBillDescription(expense.description)
    if (parsed.cheque_status !== 'pending_approval') {
        return { error: 'This bill has no pending cheque to reject.' }
    }

    const updatedDescJson = JSON.stringify({
        ...parsed,
        cheque_status: 'rejected',
        pending_cheque: undefined,
    })

    const { error: updateError } = await supabase
        .from('expenses')
        .update({ description: updatedDescJson })
        .eq('id', expenseId)
        .eq('restaurant_id', user.restaurantId)

    if (updateError) return { error: updateError.message }

    revalidatePath(PATH)
    return { success: true }
}

export async function getSupplierSettlementsAction(expenseIds: string[]) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!expenseIds || expenseIds.length === 0) return { data: [] }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('voucher_supplier_settlements')
        .select('*, day_book_entries(*, users(full_name))')
        .in('expense_id', expenseIds)
        .order('created_at', { ascending: true })

    if (error) return { error: error.message }
    return { data: data || [] }
}

export async function saveSupplierOpeningBalanceAction(input: {
    supplier_id?: string
    supplier_name: string
    amount: number
    reason: string
    is_edit: boolean
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supplierName = input.supplier_name?.trim()
    if (!supplierName) return { error: 'Supplier name is required.' }
    if (!Number.isFinite(input.amount) || input.amount < 0) return { error: 'Opening balance amount must be non-negative.' }
    const reason = input.reason?.trim()
    if (input.is_edit && !reason) return { error: 'Reason for editing opening balance is required.' }

    const supabase = await createAdminClient()

    // Get an expense category or use a default one for opening balance
    const { data: categories } = await supabase
        .from('expense_categories')
        .select('id')
        .eq('restaurant_id', user.restaurantId)
        .limit(1)

    const categoryId = categories && categories.length > 0 ? categories[0].id : null
    if (!categoryId) return { error: 'No expense category found. Please create an expense category first.' }

    // Find existing Opening Balance expense for this supplier
    const { data: existingExpenses } = await supabase
        .from('expenses')
        .select('*')
        .eq('restaurant_id', user.restaurantId)
        .ilike('vendor_name', supplierName)
        .ilike('description', '%Opening Balance%')
        .order('created_at', { ascending: true })

    const existingOb = existingExpenses && existingExpenses.length > 0 ? existingExpenses[0] : null
    let oldBalance = 0

    if (existingOb) {
        try {
            const parsed = JSON.parse(existingOb.description)
            oldBalance = Number(existingOb.amount || 0)
        } catch {
            oldBalance = Number(existingOb.amount || 0)
        }
    }

    const descObj = {
        text_desc: reason ? `Opening Balance (${reason})` : 'Opening Balance',
        quantity: null,
        rate: null,
        unit: '',
        paid_amount: 0,
        payment_type: 'UNPAID',
    }
    const descJson = JSON.stringify(descObj)

    let resultData = null

    if (existingOb) {
        const { data: updated, error: updateErr } = await supabase
            .from('expenses')
            .update({
                amount: input.amount,
                description: descJson,
            })
            .eq('id', existingOb.id)
            .select()
            .single()

        if (updateErr) return { error: updateErr.message }
        resultData = updated
    } else {
        const { data: inserted, error: insertErr } = await supabase
            .from('expenses')
            .insert({
                restaurant_id: user.restaurantId,
                category_id: categoryId,
                amount: input.amount,
                description: descJson,
                vendor_name: supplierName,
                status: 'paid',
                created_by: user.id,
            })
            .select()
            .single()

        if (insertErr) return { error: insertErr.message }
        resultData = inserted
    }

    const { logAudit } = await import('@/lib/audit')
    await logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: input.is_edit ? 'opening_balance_edited' : 'opening_balance_added',
        entityType: 'supplier',
        entityId: input.supplier_id || null,
        oldValue: { supplier_name: supplierName, opening_balance: oldBalance },
        newValue: { supplier_name: supplierName, opening_balance: input.amount, reason: reason || 'Initial opening balance set' },
    })

    revalidatePath(PATH)
    return { data: resultData }
}


