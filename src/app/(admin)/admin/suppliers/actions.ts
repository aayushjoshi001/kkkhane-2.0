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

    const supabase = await createAdminClient()

    // 1. Pack items into description JSON. paid_amount === 0 means fully on
    // credit — the bill still gets created, just with nothing posted below.
    const descJson = JSON.stringify({
        text_desc: input.text_desc.trim(),
        quantity: input.quantity,
        rate: input.rate,
        unit: input.unit || 'pcs',
        paid_amount: input.paid_amount,
        payment_type: input.payment_source,
        bank_name: input.payment_source !== 'cash' ? (input.bank_name?.trim() || '') : '',
        ...(input.payment_source === 'cash_qr' ? { cash_portion: input.cash_portion ?? 0, qr_portion: input.qr_portion ?? 0 } : {})
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

    // 3. Post paid_amount to Day Book if greater than 0. The difference
    // between amount and paid_amount is the due/outstanding balance shown
    // in the Suppliers Ledger — the bill itself is already saved, so a
    // failed Day Book posting is reported as a warning rather than failing
    // the whole action, but it must never pass silently.
    let warning: string | undefined
    if (input.paid_amount > 0) {
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

    return { data: newExpense, warning }
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

    const supabase = await createAdminClient()

    const { data: expense, error: fetchError } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', input.expense_id)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchError || !expense) return { error: 'Bill not found.' }

    let parsed: { text_desc?: string; quantity?: number; rate?: number; unit?: string; paid_amount?: number; payment_type?: string; bank_name?: string; cash_portion?: number; qr_portion?: number } = {}
    try {
        if (expense.description?.startsWith('{')) parsed = JSON.parse(expense.description)
    } catch {
        // fallback: treat as unstructured description below
    }

    const totalAmount = Number(expense.amount)
    const alreadyPaid = Number(parsed.paid_amount ?? totalAmount)
    const owed = totalAmount - alreadyPaid
    if (owed <= 0) return { error: 'This bill is already fully paid.' }
    if (input.amount > owed) return { error: `Payment cannot exceed the outstanding balance (Rs. ${owed.toFixed(2)}).` }

    const newPaidAmount = alreadyPaid + input.amount
    const updatedDescJson = JSON.stringify({
        ...parsed,
        paid_amount: newPaidAmount,
        // Keep the method that most recently touched the bill, so the
        // ledger's "Payment Type" column reflects the latest payment.
        payment_type: input.payment_source,
        bank_name: input.payment_source !== 'cash' ? (input.bank_name?.trim() || '') : '',
        ...(input.payment_source === 'cash_qr' ? { cash_portion: input.cash_portion ?? 0, qr_portion: input.qr_portion ?? 0 } : {})
    })

    const { error: updateError } = await supabase
        .from('expenses')
        .update({ description: updatedDescJson })
        .eq('id', input.expense_id)
        .eq('restaurant_id', user.restaurantId)

    if (updateError) return { error: updateError.message }

    const postResult = await postSupplierPayment(supabase, user, {
        payment_source: input.payment_source,
        amount: input.amount,
        bank_name: input.bank_name,
        cash_portion: input.cash_portion,
        qr_portion: input.qr_portion,
    }, `[Bill Payment] ${parsed.text_desc || expense.description} (Supplier: ${expense.vendor_name})`)

    let warning: string | undefined
    if (postResult.error) {
        console.error('Failed to post supplier bill payment to Day Book:', postResult.error)
        warning = `Payment saved, but it could not be posted to the Day Book: ${postResult.error}`
    }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/income-expenses')

    return { success: true, warning }
}

