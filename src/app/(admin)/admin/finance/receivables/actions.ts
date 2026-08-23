'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { postFinancialTransaction } from '@/lib/ledger'

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
    payment_method?: 'cash' | 'bank_qr'
    linked_charge_id?: string
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
    if (input.linked_charge_id || (input.breakdown && (input.breakdown.subtotal || input.breakdown.discount || input.breakdown.service_charge || input.breakdown.tax || input.breakdown.payment_method || input.breakdown.items?.length))) {
        finalDesc = JSON.stringify({
            text_desc: input.description.trim(),
            linked_charge_id: input.linked_charge_id || undefined,
            subtotal: input.breakdown?.subtotal || input.amount,
            discount: input.breakdown?.discount || 0,
            service_charge: input.breakdown?.service_charge || 0,
            tax: input.breakdown?.tax || 0,
            grand_total: input.amount,
            paid_amount: input.type === 'payment' ? input.amount : 0,
            payment_method: input.breakdown?.payment_method || (input.type === 'payment' ? 'cash' : 'credit'),
            items: input.breakdown?.items || []
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

    // When customer pays money later from ledger:
    // It is NOT added to income again, but IS added to Cash In or Bank In in the Day Book.
    if (input.type === 'payment') {
        const customerName = data.customer_credit_accounts?.customer_name || 'Customer'
        const method = input.payment_method === 'bank_qr' ? 'bank_qr' : 'cash'
        const dayBookType = method === 'bank_qr' ? 'bank_in' : 'cash_in'

        await postFinancialTransaction(
            supabase,
            { id: user.id, restaurantId: user.restaurantId },
            {
                type: dayBookType,
                amount: input.amount,
                description: `Customer credit settlement: ${customerName} (${input.description.trim()})`,
                category: 'order_payment',
                requireOpenSession: false,
                // Link the Day Book side to this transaction so deleting the
                // payment can remove it too. Unlinked, a mis-keyed payment that
                // was deleted and re-entered left two cash_in rows against one
                // receipt — and the cashier whose window they fell in was then
                // docked the difference by shift-cash reconciliation.
                referenceId: data.id,
            }
        )
    }

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

    // Remove the Day Book entry this transaction posted. Only rows stamped with
    // this transaction's id are touched; anything recorded before the link
    // existed has no reference_id and stays put.
    const { error: dbErr } = await supabase
        .from('day_book_entries')
        .delete()
        .eq('restaurant_id', user.restaurantId)
        .eq('reference_id', id)

    revalidatePath(PATH)
    revalidatePath('/admin/customers')
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    if (dbErr) {
        return { success: true, warning: `Transaction deleted, but its Day Book entry could not be removed: ${dbErr.message}` }
    }
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
    let targetId = parsedMeta?.order_id || parsedMeta?.booking_id || (uuidMatch ? uuidMatch[1] : null)

    // 0. Fallback: Parse room numbers from description string (e.g. "Rooms 101, 102 stay on credit...")
    let bkgSearchIds: string[] = targetId ? [targetId] : []
    if (!targetId && txn.description) {
        const roomMatch = txn.description.match(/Rooms?\s+([0-9A-Za-z,\s]+?)(?=\s+stay|\s+on|\s*\(|\s*$)/i)
        if (roomMatch && roomMatch[1]) {
            const rawRoomNumbers = roomMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean)
            if (rawRoomNumbers.length > 0) {
                const { data: matchedRooms } = await supabase
                    .from('rooms')
                    .select('id, room_number')
                    .eq('restaurant_id', user.restaurantId)
                    .in('room_number', rawRoomNumbers)

                if (matchedRooms && matchedRooms.length > 0) {
                    const roomIds = matchedRooms.map(r => r.id)
                    let bkgQuery = supabase
                        .from('bookings')
                        .select('id, group_id')
                        .eq('restaurant_id', user.restaurantId)
                        .in('room_id', roomIds)

                    if (txn.created_at) {
                        bkgQuery = bkgQuery.lte('created_at', txn.created_at)
                    }

                    const { data: bkgRows } = await bkgQuery
                        .order('created_at', { ascending: false })
                        .limit(1)

                    if (bkgRows && bkgRows.length > 0) {
                        bkgSearchIds = bkgRows.map(b => b.id)
                        const groupIds = bkgRows.map(b => b.group_id).filter(Boolean)
                        if (groupIds.length > 0) {
                            const { data: groupBkgs } = await supabase
                                .from('bookings')
                                .select('id')
                                .eq('restaurant_id', user.restaurantId)
                                .in('group_id', groupIds)
                            if (groupBkgs) {
                                bkgSearchIds = Array.from(new Set([...bkgSearchIds, ...groupBkgs.map(g => g.id)]))
                            }
                        }
                    }
                }
            }
        }
    }

    // 1. Try finding linked order & order items if targetId was an order
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
        }
    }

    // 2. Try finding linked bookings & room details (for single or group stays)
    if (finalItems.length === 0 && bkgSearchIds.length > 0) {
        const { data: bkgs } = await supabase
            .from('bookings')
            .select('*, rooms(*)')
            .eq('restaurant_id', user.restaurantId)
            .in('id', bkgSearchIds)
            .order('created_at', { ascending: true })

        if (bkgs && bkgs.length > 0) {
            bookingData = bkgs[0]
            const bookingIds = bkgs.map(b => b.id)

            // Fetch all linked food orders & items for these bookings
            const { data: linkedOrders } = await supabase
                .from('orders')
                .select('id, total_amount, subtotal_amount, order_items(id, quantity, unit_price, menu_items(name))')
                .eq('restaurant_id', user.restaurantId)
                .in('booking_id', bookingIds)
                .neq('status', 'cancelled')

            let foodTotal = 0
            const foodItems: Array<{ id?: string; name: string; quantity: number; unit_price: number }> = []

            if (linkedOrders && linkedOrders.length > 0) {
                for (const ord of linkedOrders) {
                    for (const it of (ord.order_items || [])) {
                        const itemName = (it as any).menu_items?.name || (it as any).item_name || 'Food / Beverage Item'
                        const qty = Number(it.quantity || 1)
                        const rate = Number(it.unit_price || 0)
                        foodTotal += qty * rate
                        foodItems.push({
                            id: it.id,
                            name: itemName,
                            quantity: qty,
                            unit_price: rate,
                        })
                    }
                }
            }

            // Fetch advance payments recorded for these bookings (only count actual advance deposits)
            const { data: bkgPayments } = await supabase
                .from('booking_payments')
                .select('amount, payment_method, note')
                .eq('restaurant_id', user.restaurantId)
                .in('booking_id', bookingIds)

            let totalAdvancePaid = Number(parsedMeta?.advance_paid ?? 0)
            const advanceNotes: string[] = []

            if (bkgPayments && bkgPayments.length > 0) {
                for (const p of bkgPayments) {
                    // The settlement taken at checkout is written to this same
                    // table; counting it as an advance made a bill that is still
                    // owed read as nothing due. Only deposits count here — the
                    // same 'Settlement' note bookingBill.ts keys on.
                    if ((p.note || '').trim().toLowerCase() === 'settlement') continue
                    const pAmt = Number(p.amount || 0)
                    totalAdvancePaid += pAmt
                    if (p.note) advanceNotes.push(p.note)
                }
            }

            let totalStayCost = 0
            let roomDiscountAmt = Number(parsedMeta?.room_discount ?? 0)
            let foodDiscountAmt = Number(parsedMeta?.food_discount ?? 0)
            let discountReasons: string[] = []

            for (const bkg of bkgs) {
                const roomName = bkg.rooms?.room_number ? `Room ${bkg.rooms.room_number}` : 'Hotel Room Stay'
                const bkgTotal = Number(bkg.total_amount || 0)
                const bkgDiscount = Number(bkg.discount_amount || 0)
                const bkgFoodDiscount = Number((bkg as any).food_discount_amount || 0)

                roomDiscountAmt += bkgDiscount
                foodDiscountAmt += bkgFoodDiscount

                if (bkg.discount_reason) discountReasons.push(bkg.discount_reason)

                // Share room stay cost
                const bkgStay = Math.max(0, bkgTotal + bkgDiscount)
                totalStayCost += bkgStay

                finalItems.push({
                    id: bkg.id,
                    name: `${roomName} Lodging & Room Stay`,
                    quantity: 1,
                    unit_price: bkgStay,
                })
            }

            // Push all food items line-by-line individually
            finalItems.push(...foodItems)

            const rawSubtotal = totalStayCost + foodTotal
            let totalDiscountAmt = roomDiscountAmt + foodDiscountAmt

            // If explicit discount was not logged on booking rows, but subtotal exceeds the grand total bill, compute the implicit discount
            if (totalDiscountAmt === 0 && parsedMeta?.discount) {
                totalDiscountAmt = Number(parsedMeta.discount)
                roomDiscountAmt = totalDiscountAmt
            } else if (totalDiscountAmt === 0 && rawSubtotal > Number(txn.amount) && totalAdvancePaid === 0) {
                totalDiscountAmt = Math.max(0, rawSubtotal - Number(txn.amount))
                if (totalStayCost > 0) {
                    roomDiscountAmt = totalDiscountAmt
                } else {
                    foodDiscountAmt = totalDiscountAmt
                }
            }

            const grandTotalAmt = Math.max(0, rawSubtotal - totalDiscountAmt)
            const netLedgerAmt = Math.max(0, grandTotalAmt - totalAdvancePaid)

            parsedMeta = {
                ...(parsedMeta || {}),
                subtotal: rawSubtotal,
                discount: totalDiscountAmt,
                room_discount: roomDiscountAmt,
                food_discount: foodDiscountAmt,
                discount_reason: discountReasons.join(', ') || parsedMeta?.discount_reason || (totalDiscountAmt > 0 ? 'Discount / Bargain Applied' : ''),
                discount_applied: totalDiscountAmt > 0,
                advance_paid: totalAdvancePaid,
                advance_notes: advanceNotes.join(', ') || parsedMeta?.advance_note || '',
                grand_total: grandTotalAmt,
                net_ledger_amount: netLedgerAmt,
                stay_cost: totalStayCost,
                food_cost: foodTotal,
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

    // Query all payments collected specifically for this bill
    let billPaymentHistory: Array<{ id: string; amount: number; created_at: string; description: string; payment_method?: string }> = []
    let totalBillPaymentsCollected = 0

    if (txn.type === 'charge' && txn.customer_credit_account_id) {
        const { data: allPayTxns } = await supabase
            .from('receivable_transactions')
            .select('id, amount, created_at, description')
            .eq('customer_credit_account_id', txn.customer_credit_account_id)
            .eq('type', 'payment')
            .order('created_at', { ascending: true })

        if (allPayTxns && allPayTxns.length > 0) {
            const rawTargetDesc = (parsedMeta?.text_desc || txn.description || '').toLowerCase()
            const targetClean = rawTargetDesc.replace(/^[\{\}\"'\s\d\w]*?:\s*/, '').trim()

            for (const p of allPayTxns) {
                let isMatch = false
                let pMeta: any = null
                try {
                    if (p.description?.startsWith('{')) pMeta = JSON.parse(p.description)
                } catch {}

                const pTextDesc = (pMeta?.text_desc || p.description || '').toLowerCase()

                if (pMeta?.linked_charge_id === txn.id) {
                    isMatch = true
                } else if (targetClean && pTextDesc) {
                    if (pTextDesc.includes(targetClean) || targetClean.includes(pTextDesc.replace('payment for ', ''))) {
                        isMatch = true
                    }
                }

                if (isMatch) {
                    const pAmt = Number(p.amount || 0)
                    totalBillPaymentsCollected += pAmt
                    billPaymentHistory.push({
                        id: p.id,
                        amount: pAmt,
                        created_at: p.created_at,
                        description: pMeta?.text_desc || p.description,
                        payment_method: pMeta?.payment_method || 'cash'
                    })
                }
            }
        }
    }

    const netLedgerChargeAmt = Number(txn.amount || 0)
    const remainingBillDue = Math.max(0, netLedgerChargeAmt - totalBillPaymentsCollected)

    parsedMeta = {
        ...(parsedMeta || {}),
        payments_collected_for_bill: totalBillPaymentsCollected,
        remaining_bill_due: remainingBillDue,
        bill_payment_history: billPaymentHistory,
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
