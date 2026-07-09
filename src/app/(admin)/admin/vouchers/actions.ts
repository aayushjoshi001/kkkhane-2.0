'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { SupabaseClient } from '@supabase/supabase-js'

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

// Helper to post supplier ledger or staff payroll deductions upon approval
async function postLedgerEntry(supabase: SupabaseClient, user: CurrentUserType, voucher: {
    voucher_type: 'receipt' | 'payment'
    category?: 'suppliers' | 'staff' | 'expenses' | 'other'
    supplier_id?: string
    staff_user_id?: string
    party_name: string
    amount: number
    particulars: string
    payment_mode: string
    bank_name?: string
}) {
    if (voucher.voucher_type !== 'payment') return // Only payments reduce outstanding balances

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

        // Insert into expenses table with amount=0 and paid_amount=voucher.amount to offset balance
        await supabase
            .from('expenses')
            .insert({
                restaurant_id: user.restaurantId,
                category_id: categoryId,
                amount: 0,
                description: descJson,
                vendor_name: voucher.party_name,
                status: 'paid',
                created_by: user.id
            })
    } else if (voucher.category === 'staff' && voucher.staff_user_id) {
        // Post payment to staff_ledger to reduce owed balance
        await supabase
            .from('staff_ledger')
            .insert({
                restaurant_id: user.restaurantId,
                user_id: voucher.staff_user_id,
                amount: voucher.amount,
                entry_type: 'salary_payout',
                payment_method: voucher.payment_mode === 'cash' ? 'cash' : 'bank',
                note: `Payment Voucher: ${voucher.particulars}`,
                created_by: user.id
            })
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
    category?: 'suppliers' | 'staff' | 'expenses' | 'other'
    supplier_id?: string
    staff_user_id?: string
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
    const now = new Date()
    const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000
    const todayDateNst = new Date(now.getTime() + NST_OFFSET_MS).toISOString().split('T')[0]

    const { data: openSession } = await supabase
        .from('day_book_sessions')
        .select('id')
        .eq('restaurant_id', user.restaurantId)
        .eq('date', todayDateNst)
        .eq('status', 'open')
        .maybeSingle()

    if (!openSession) {
        return { error: 'No active Day Book session is open. Please open Cash Book or Bank Book to start a session first.' }
    }

    // Determine ownership type if Bank selected
    let isPersonalAccount = false
    if ((input.payment_mode === 'qr' || input.payment_mode === 'cheque' || input.payment_mode === 'bank') && input.bank_name) {
        const { data: bankAcc } = await supabase
            .from('bank_accounts')
            .select('bank_name')
            .eq('restaurant_id', user.restaurantId)
            .eq('name', input.bank_name.trim())
            .maybeSingle()
        if (bankAcc?.bank_name?.startsWith('personal:')) {
            isPersonalAccount = true
        }
    }

    // ── Generate sequential Voucher Number
    const { data: existingEntries } = await supabase
        .from('day_book_entries')
        .select('description')
        .eq('session_id', openSession.id)
        .like('description', '{"voucher_type"%')

    const voucherCount = existingEntries ? existingEntries.length : 0
    const sequenceStr = String(voucherCount + 1).padStart(3, '0')
    
    const dateCompact = todayDateNst.replace(/-/g, '').substring(2)
    const prefix = input.voucher_type === 'receipt' ? 'RV' : 'PV'
    const voucherNumber = `${prefix}-${dateCompact}-${sequenceStr}`

    // Cheque approval rules
    // Receipt normal cheque OR Payment personal cheque requires manager approval
    const needsApproval = input.payment_mode === 'cheque' && 
        (input.voucher_type === 'receipt' 
            ? input.cheque_details?.cheque_type === 'normal'
            : isPersonalAccount)

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
        cheque_details: input.payment_mode === 'cheque' ? input.cheque_details : undefined
    })

    // Determine day book entry properties
    const dbType = input.voucher_type === 'receipt'
        ? (input.payment_mode === 'cash' ? 'cash_in' : 'bank_in')
        : (input.payment_mode === 'cash' ? 'cash_out' : 'bank_out')

    const dbCategory = input.voucher_type === 'receipt'
        ? (input.payment_mode === 'cash' ? 'other' : (input.payment_mode === 'qr' ? 'qr_payment' : 'deposit'))
        : (input.payment_mode === 'cash' ? 'expense' : 'transfer_out')

    const { data: newEntry, error } = await supabase
        .from('day_book_entries')
        .insert({
            session_id: openSession.id,
            restaurant_id: user.restaurantId,
            type: dbType,
            amount: dbAmount,
            description: voucherDesc,
            category: dbCategory,
            bank_name: input.payment_mode !== 'cash' ? input.bank_name?.trim() : null,
            created_by: user.id
        })
        .select('*, day_book_sessions(date)')
        .single()

    if (error) return { error: error.message }

    // If approved immediately, post ledger impacts
    if (status === 'approved') {
        await postLedgerEntry(supabase, user, {
            voucher_type: input.voucher_type,
            category: input.category,
            supplier_id: input.supplier_id,
            staff_user_id: input.staff_user_id,
            party_name: input.party_name,
            amount: input.amount,
            particulars: input.particulars,
            payment_mode: input.payment_mode,
            bank_name: input.bank_name
        })
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

        // Post ledger impacts now that it is approved
        await postLedgerEntry(supabase, user, {
            voucher_type: parsed.voucher_type,
            category: parsed.category,
            supplier_id: parsed.supplier_id,
            staff_user_id: parsed.staff_user_id,
            party_name: parsed.party_name,
            amount: parsed.amount,
            particulars: parsed.particulars,
            payment_mode: parsed.payment_mode,
            bank_name: parsed.bank_name
        })

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

export async function deleteVoucherAction(id: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const { error, count } = await supabase
        .from('day_book_entries')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)

    if (error) return { error: error.message }
    if (!count) return { error: 'Voucher not found.' }

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')

    return { success: true }
}
