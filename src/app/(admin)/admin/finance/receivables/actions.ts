'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/receivables'

// ── Customer Credit Accounts ─────────────────────────────────
export async function createCustomerCreditAccountAction(input: { customer_name: string; customer_phone?: string; credit_limit?: number }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer credit accounts.' } }
    const customer_name = input.customer_name?.trim()
    if (!customer_name) return { error: 'Customer name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('customer_credit_accounts')
        .insert({
            customer_name,
            customer_phone: input.customer_phone?.trim() || null,
            credit_limit: input.credit_limit ?? 0,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateCustomerCreditAccountAction(id: string, updates: { customer_name?: string; customer_phone?: string; credit_limit?: number; is_active?: boolean }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer credit accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('customer_credit_accounts').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteCustomerCreditAccountAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer credit accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('customer_credit_accounts').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Receivable Transactions (Payment Collection / Charges) ────
export async function createReceivableTransactionAction(input: {
    customer_credit_account_id: string
    type: 'charge' | 'payment'
    amount: number
    description: string
    breakdown?: {
        subtotal?: number
        discount?: number
        service_charge?: number
        tax?: number
        payment_method?: string
        items?: Array<{ name: string; quantity: number; unit_price: number }>
    }
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage receivable transactions.' } }
    if (!input.customer_credit_account_id) return { error: 'A customer credit account is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }

    let finalDesc = input.description.trim()
    if (input.breakdown && (input.breakdown.subtotal || input.breakdown.discount || input.breakdown.service_charge || input.breakdown.tax || input.breakdown.payment_method || input.breakdown.items?.length)) {
        finalDesc = JSON.stringify({
            text_desc: input.description.trim(),
            subtotal: input.breakdown.subtotal || input.amount,
            discount: input.breakdown.discount || 0,
            service_charge: input.breakdown.service_charge || 0,
            tax: input.breakdown.tax || 0,
            grand_total: input.amount,
            paid_amount: input.type === 'payment' ? input.amount : 0,
            payment_method: input.breakdown.payment_method || (input.type === 'payment' ? 'cash' : 'credit'),
            items: input.breakdown.items || []
        })
    }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('receivable_transactions')
        .insert({
            customer_credit_account_id: input.customer_credit_account_id,
            type: input.type,
            amount: input.amount,
            description: finalDesc,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, customer_credit_accounts(*)')
        .single()

    if (error) return { error: error.message }

    // If it's a credit charge (bill), recognize it as Sales Income for today on accrual basis
    if (input.type === 'charge') {
        try {
            const { data: incomeCat } = await supabase
                .from('income_categories')
                .select('id')
                .eq('restaurant_id', user.restaurantId)
                .ilike('name', '%sale%')
                .maybeSingle()

            let catId = incomeCat?.id
            if (!catId) {
                const { data: anyCat } = await supabase
                    .from('income_categories')
                    .select('id')
                    .eq('restaurant_id', user.restaurantId)
                    .limit(1)
                    .maybeSingle()
                catId = anyCat?.id
            }

            if (catId) {
                const custName = data.customer_credit_accounts?.customer_name || 'Customer'
                const cleanDesc = input.description.trim()
                await supabase.from('income_entries').insert({
                    restaurant_id: user.restaurantId,
                    category_id: catId,
                    amount: input.amount,
                    description: `Credit Sale (${custName}): ${cleanDesc}`,
                })
            }
        } catch {
            // Ignore error if income entry optional insert fails
        }
    }

    revalidatePath(PATH)
    revalidatePath('/admin/customers')
    revalidatePath('/admin/income-expenses')
    return { data }
}

export async function deleteReceivableTransactionAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage receivable transactions.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('receivable_transactions').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Transaction not found.' }
    revalidatePath(PATH)
    revalidatePath('/admin/customers')
    return { success: true }
}

export async function saveCustomerOpeningBalanceAction(input: {
    customer_credit_account_id: string
    amount: number
    reason: string
    is_edit: boolean
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer opening balances.' } }
    if (!input.customer_credit_account_id) return { error: 'Customer credit account ID is required.' }
    if (!Number.isFinite(input.amount) || input.amount < 0) return { error: 'Opening balance amount must be non-negative.' }
    const reason = input.reason?.trim()
    if (input.is_edit && !reason) return { error: 'Reason for editing opening balance is required.' }

    const supabase = await createAdminClient()

    const { data: customer, error: custErr } = await supabase
        .from('customer_credit_accounts')
        .select('*')
        .eq('id', input.customer_credit_account_id)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (custErr || !customer) return { error: 'Customer credit account not found.' }

    // Check for existing opening balance transaction
    const { data: existingTxns } = await supabase
        .from('receivable_transactions')
        .select('*')
        .eq('customer_credit_account_id', input.customer_credit_account_id)
        .eq('restaurant_id', user.restaurantId)
        .ilike('description', 'Opening Balance%')
        .order('created_at', { ascending: true })

    const existingObTxn = existingTxns && existingTxns.length > 0 ? existingTxns[0] : null
    const oldBalance = existingObTxn ? Number(existingObTxn.amount) : 0

    let resultTxn = null
    const description = reason
        ? `Opening Balance (${reason})`
        : 'Opening Balance'

    if (existingObTxn) {
        const { data: updated, error: updateErr } = await supabase
            .from('receivable_transactions')
            .update({
                amount: input.amount,
                description,
            })
            .eq('id', existingObTxn.id)
            .select()
            .single()

        if (updateErr) return { error: updateErr.message }
        resultTxn = updated
    } else {
        const { data: inserted, error: insertErr } = await supabase
            .from('receivable_transactions')
            .insert({
                customer_credit_account_id: input.customer_credit_account_id,
                type: 'charge',
                amount: input.amount,
                description,
                restaurant_id: user.restaurantId,
                created_by: user.id,
            })
            .select()
            .single()

        if (insertErr) return { error: insertErr.message }
        resultTxn = inserted
    }

    const { logAudit } = await import('@/lib/audit')
    await logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: input.is_edit ? 'opening_balance_edited' : 'opening_balance_added',
        entityType: 'customer_credit_account',
        entityId: input.customer_credit_account_id,
        oldValue: { customer_name: customer.customer_name, opening_balance: oldBalance },
        newValue: { customer_name: customer.customer_name, opening_balance: input.amount, reason: reason || 'Initial opening balance set' },
    })

    revalidatePath(PATH)
    revalidatePath('/admin/customers')
    return { data: resultTxn }
}

export async function getTransactionDetailsAction(transactionId: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'Unauthorized' } }
    if (!transactionId) return { error: 'Transaction ID is required.' }

    const supabase = await createAdminClient()

    const { data: txn, error } = await supabase
        .from('receivable_transactions')
        .select('*, customer_credit_accounts(*)')
        .eq('id', transactionId)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (error || !txn) return { error: 'Transaction not found.' }

    let parsedMeta: Record<string, any> | null = null
    try {
        if (txn.description?.startsWith('{')) {
            parsedMeta = JSON.parse(txn.description)
        }
    } catch {
        // ignore
    }

    let orderData: any = null
    let bookingData: any = null
    let finalItems: Array<{ id?: string; name: string; quantity: number; unit_price: number }> = []

    const uuidMatch = txn.description?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    const targetId = parsedMeta?.order_id || parsedMeta?.booking_id || (uuidMatch ? uuidMatch[1] : null)

    // 1. Try finding linked order & order items
    if (targetId) {
        const { data: ord } = await supabase
            .from('orders')
            .select('*, order_items(*, menu_items(name))')
            .eq('id', targetId)
            .eq('restaurant_id', user.restaurantId)
            .maybeSingle()

        if (ord) {
            orderData = ord
            finalItems = (ord.order_items || []).map((it: any) => ({
                id: it.id,
                name: it.menu_items?.name || it.item_name || 'Food / Beverage Item',
                quantity: Number(it.quantity || 1),
                unit_price: Number(it.unit_price || 0),
            }))
        } else {
            // 2. Try finding linked booking & room details
            const { data: bkg } = await supabase
                .from('bookings')
                .select('*, rooms(*)')
                .eq('id', targetId)
                .eq('restaurant_id', user.restaurantId)
                .maybeSingle()

            if (bkg) {
                bookingData = bkg
                const roomName = bkg.rooms?.room_number ? `Room ${bkg.rooms.room_number}` : 'Hotel Room Stay'
                finalItems.push({
                    id: bkg.id,
                    name: `${roomName} Lodging & Stay Charge`,
                    quantity: 1,
                    unit_price: Number(bkg.total_amount || txn.amount),
                })
            }
        }
    }

    // 3. Check if explicit items array was saved in description metadata
    if (finalItems.length === 0 && Array.isArray(parsedMeta?.items) && parsedMeta.items.length > 0) {
        finalItems = parsedMeta.items.map((it: any) => ({
            name: it.name || it.item_name || 'Bill Item',
            quantity: Number(it.quantity || 1),
            unit_price: Number(it.unit_price || it.rate || 0),
        }))
    }

    // 4. Fallback: Synthesize clean category itemized lines if none found
    if (finalItems.length === 0) {
        const descText = (parsedMeta?.text_desc || parsedMeta?.text || txn.description || '').toLowerCase()
        const subtotalAmt = Number(parsedMeta?.subtotal || txn.amount)

        if (descText.includes('opening balance')) {
            finalItems.push({
                name: 'Opening Balance (Initial Ledger Balance)',
                quantity: 1,
                unit_price: subtotalAmt,
            })
        } else if (descText.includes('room') || descText.includes('stay') || descText.includes('hotel') || descText.includes('booking')) {
            finalItems.push({
                name: 'Hotel Room Stay & Accommodation Charge',
                quantity: 1,
                unit_price: subtotalAmt,
            })
        } else if (descText.includes('food') || descText.includes('dine') || descText.includes('order') || descText.includes('bill')) {
            finalItems.push({
                name: 'Food & Beverage Order Bill',
                quantity: 1,
                unit_price: subtotalAmt,
            })
        } else if (txn.type === 'payment') {
            finalItems.push({
                name: 'Customer Ledger Payment Received',
                quantity: 1,
                unit_price: subtotalAmt,
            })
        } else {
            finalItems.push({
                name: parsedMeta?.text_desc || parsedMeta?.text || txn.description || 'Customer Ledger Charge',
                quantity: 1,
                unit_price: subtotalAmt,
            })
        }
    }

    return {
        data: {
            transaction: txn,
            parsedMeta,
            orderData,
            bookingData,
            finalItems,
        }
    }
}
