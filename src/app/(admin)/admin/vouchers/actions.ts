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
    payment_mode: 'cash' | 'bank'
    bank_name?: string
    particulars: string
    reference_no?: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!input.party_name?.trim()) return { error: 'Party name (Paid to / Received from) is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.particulars?.trim()) return { error: 'Particulars description is required.' }
    if (input.payment_mode === 'bank' && !input.bank_name?.trim()) {
        return { error: 'Bank Name is required when payment mode is Bank.' }
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
    // Query all day_book_entries under the current session that contain voucher JSON description
    const { data: existingEntries } = await supabase
        .from('day_book_entries')
        .select('description')
        .eq('session_id', openSession.id)
        .like('description', '{"voucher_type"%')

    const voucherCount = existingEntries ? existingEntries.length : 0
    const sequenceStr = String(voucherCount + 1).padStart(3, '0')
    
    // Clean formatted date: YYMMDD
    const dateCompact = todayDateNst.replace(/-/g, '').substring(2)
    const prefix = input.voucher_type === 'receipt' ? 'RV' : 'PV'
    const voucherNumber = `${prefix}-${dateCompact}-${sequenceStr}`

    // ── Package Voucher details into JSON description
    const voucherDesc = JSON.stringify({
        voucher_type: input.voucher_type,
        voucher_number: voucherNumber,
        party_name: input.party_name.trim(),
        particulars: input.particulars.trim(),
        payment_mode: input.payment_mode,
        bank_name: input.payment_mode === 'bank' ? input.bank_name?.trim() : '',
        reference_no: input.reference_no?.trim() || ''
    })

    // Determine day book entry properties
    const dbType = input.voucher_type === 'receipt'
        ? (input.payment_mode === 'cash' ? 'cash_in' : 'bank_in')
        : (input.payment_mode === 'cash' ? 'cash_out' : 'bank_out')

    const dbCategory = input.voucher_type === 'receipt'
        ? (input.payment_mode === 'cash' ? 'other' : 'deposit')
        : (input.payment_mode === 'cash' ? 'expense' : 'transfer_out')

    // Find and map bank_account_id if paid via bank

    const { data: newEntry, error } = await supabase
        .from('day_book_entries')
        .insert({
            session_id: openSession.id,
            restaurant_id: user.restaurantId,
            type: dbType,
            amount: input.amount,
            description: voucherDesc,
            category: dbCategory,
            bank_name: input.payment_mode === 'bank' ? input.bank_name?.trim() : null,
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
