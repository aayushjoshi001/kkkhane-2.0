'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { postFinancialTransaction, resolveBankAccountId } from '@/lib/ledger'

async function requireManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/suppliers'

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
    supplier_name: string
    category_id: string
    text_desc: string
    quantity: number
    rate: number
    unit: string
    amount: number
    paid_amount: number
    payment_source: 'cash' | 'bank'
    bank_name?: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!input.supplier_name) return { error: 'Supplier is required.' }
    if (!input.category_id) return { error: 'Category is required.' }
    if (!input.text_desc?.trim()) return { error: 'Description is required.' }
    if (input.quantity <= 0) return { error: 'Quantity must be positive.' }
    if (input.rate <= 0) return { error: 'Rate must be positive.' }
    if (input.paid_amount < 0) return { error: 'Paid amount cannot be negative.' }
    if (input.paid_amount > input.amount) return { error: 'Paid amount cannot exceed total amount.' }

    const supabase = await createAdminClient()

    // 1. Pack items into description JSON
    const descJson = JSON.stringify({
        text_desc: input.text_desc.trim(),
        quantity: input.quantity,
        rate: input.rate,
        unit: input.unit || 'pcs',
        paid_amount: input.paid_amount,
        payment_type: input.payment_source,
        bank_name: input.payment_source === 'bank' ? (input.bank_name?.trim() || '') : ''
    })

    const bankAccountId = input.payment_source === 'bank'
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
            vendor_name: input.supplier_name,
            status: 'paid',
            bank_account_id: bankAccountId,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
            created_by: user.id
        })
        .select('*, expense_categories(*), bank_accounts(*)')
        .single()

    if (expError) return { error: expError.message }

    // 3. Post paid_amount to Day Book if greater than 0.
    // The bill itself is already saved, so a failed Day Book posting is
    // reported as a warning rather than failing the whole action — but it
    // must never pass silently, or the books quietly disagree with the bill.
    let warning: string | undefined
    if (input.paid_amount > 0) {
        const postResult = await postFinancialTransaction(supabase, user, {
            type: input.payment_source === 'cash' ? 'cash_out' : 'bank_out',
            amount: input.paid_amount,
            description: `[Supplier Bill Paid] ${input.text_desc.trim()} (Supplier: ${input.supplier_name})`,
            category: input.payment_source === 'cash' ? 'expense' : 'transfer_out',
            bankName: input.payment_source === 'bank' ? input.bank_name : null
        })

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

