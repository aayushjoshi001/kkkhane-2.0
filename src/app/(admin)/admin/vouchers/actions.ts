'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

const PATH = '/admin/vouchers'

async function requireManager() {
    const user = await getCurrentUser()
    if (!user || !user.restaurantId) throw new Error('Unauthorized')
    return user
}

export async function createVoucherAction(input: {
    voucher_type: 'receipt' | 'payment'
    party_name: string
    amount: number
    payment_mode: 'cash' | 'qr' | 'cheque' | 'bank'
    bank_name?: string // Destination Bank Account
    particulars: string
    reference_no?: string // Payer Phone Number
    receiver_name?: string
    cheque_details?: {
        written_name: string
        bank_cheque: string // Issuer Bank (e.g. Global IME)
        cheque_number: string
        cheque_date: string
        cheque_type: 'ac_payee' | 'normal'
    }
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!input.party_name?.trim()) return { error: 'Party name (Paid to / Received from) is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.particulars?.trim()) return { error: 'Particulars description is required.' }
    if ((input.payment_mode === 'qr' || input.payment_mode === 'cheque' || input.payment_mode === 'bank') && !input.bank_name?.trim()) {
        return { error: 'Destination bank name is required.' }
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
    const isNormalCheque = input.payment_mode === 'cheque' && input.cheque_details?.cheque_type === 'normal'
    const status = isNormalCheque ? 'pending_approval' : 'approved'
    const dbAmount = isNormalCheque ? 0.01 : input.amount // Use 0.01 for pending cheque to satisfy constraint without altering balances

    // ── Package Voucher details into JSON description
    const voucherDesc = JSON.stringify({
        voucher_type: input.voucher_type,
        voucher_number: voucherNumber,
        party_name: input.party_name.trim(),
        particulars: input.particulars.trim(),
        payment_mode: input.payment_mode,
        bank_name: (input.payment_mode !== 'cash' ? input.bank_name?.trim() : '') || '',
        reference_no: input.reference_no?.trim() || '', // Payer phone
        receiver_name: input.receiver_name?.trim() || '',
        status: status,
        amount: input.amount, // Real amount stored here!
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
                amount: 0.01, // Keep dummy amount to keep constraint happy
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
