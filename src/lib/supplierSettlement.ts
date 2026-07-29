// Settles a supplier's overall outstanding balance across however many bills
// it takes, oldest first — the counterpart to Suppliers Ledger's per-bill
// paid_amount tracking (expenses.description JSON) for a Payment Voucher
// that pays "the supplier" rather than one specific bill.

import { SupabaseClient } from '@supabase/supabase-js'
import { parseExpenseDescription } from './utils'

export interface OutstandingBill {
    id: string
    amount: number
    paidAmount: number
    owed: number
    createdAt: string
    description: string
}

// `%`/`_` are ilike wildcards — escaped so a supplier literally named
// "50% Off Co" doesn't match more vendor_name rows than it should.
function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export async function fetchOutstandingSupplierBills(
    supabase: SupabaseClient,
    restaurantId: string,
    supplierName: string
): Promise<OutstandingBill[]> {
    const { data } = await supabase
        .from('expenses')
        .select('id, amount, description, created_at')
        .eq('restaurant_id', restaurantId)
        .ilike('vendor_name', escapeLikePattern(supplierName.trim()))
        .order('created_at', { ascending: true })

    return (data ?? [])
        .map(row => {
            const parsed = parseExpenseDescription(row.description)
            const amount = Number(row.amount)
            const paidAmount = Number(parsed.paid_amount ?? amount)
            return {
                id: row.id,
                amount,
                paidAmount,
                owed: amount - paidAmount,
                createdAt: row.created_at,
                description: row.description,
            }
        })
        .filter(bill => bill.owed > 0.01)
}

export function sumOwed(bills: OutstandingBill[]): number {
    return bills.reduce((sum, b) => sum + b.owed, 0)
}

export interface FifoAllocation {
    bill: OutstandingBill
    amountApplied: number
    newPaidAmount: number
}

// Pure — no DB access, easy to unit-reason-about and reuse for a client-side
// preview if ever needed.
export function computeFifoAllocations(bills: OutstandingBill[], amount: number): FifoAllocation[] {
    const allocations: FifoAllocation[] = []
    let remaining = amount
    for (const bill of bills) {
        if (remaining <= 0.01) break
        const applied = Math.min(bill.owed, remaining)
        allocations.push({ bill, amountApplied: applied, newPaidAmount: bill.paidAmount + applied })
        remaining -= applied
    }
    return allocations
}

// Applies the computed allocations: updates each touched bill's paid_amount
// JSON field and records an audit row per bill so the settlement can be
// reversed precisely if the voucher that caused it is later deleted.
export async function applySupplierFifoAllocations(
    supabase: SupabaseClient,
    params: {
        restaurantId: string
        dayBookEntryId: string
        paymentMode: string
        bankName?: string
        allocations: FifoAllocation[]
    }
): Promise<{ error?: string }> {
    // Audit row inserted immediately after each bill's own update (not
    // batched at the end) — so if a later bill in the same settlement fails,
    // everything that already succeeded is still accurately reversible.
    for (const { bill, newPaidAmount, amountApplied } of params.allocations) {
        const parsed = parseExpenseDescription(bill.description)
        const updatedDescJson = JSON.stringify({
            ...parsed,
            paid_amount: newPaidAmount,
            payment_type: params.paymentMode === 'cash' ? 'cash' : params.paymentMode,
            bank_name: params.paymentMode !== 'cash' ? (params.bankName?.trim() || '') : '',
        })

        const { error: updateError } = await supabase
            .from('expenses')
            .update({ description: updatedDescJson })
            .eq('id', bill.id)
            .eq('restaurant_id', params.restaurantId)

        if (updateError) return { error: updateError.message }

        const { error: auditError } = await supabase
            .from('voucher_supplier_settlements')
            .insert({
                restaurant_id: params.restaurantId,
                day_book_entry_id: params.dayBookEntryId,
                expense_id: bill.id,
                amount: amountApplied,
            })

        if (auditError) return { error: auditError.message }
    }

    return {}
}

// Undoes a settlement voucher's effect on the bills it touched — called
// before the voucher's day_book_entries row is deleted (that delete cascades
// away the audit rows this reads, so it must read them first).
export async function reverseSupplierFifoAllocations(
    supabase: SupabaseClient,
    dayBookEntryId: string
): Promise<void> {
    const { data: settlements } = await supabase
        .from('voucher_supplier_settlements')
        .select('expense_id, amount')
        .eq('day_book_entry_id', dayBookEntryId)

    for (const settlement of settlements ?? []) {
        const { data: expense } = await supabase
            .from('expenses')
            .select('id, amount, description, restaurant_id')
            .eq('id', settlement.expense_id)
            .maybeSingle()

        if (!expense) continue

        const parsed = parseExpenseDescription(expense.description)
        const currentPaid = Number(parsed.paid_amount ?? expense.amount)
        const revertedPaid = Math.max(0, currentPaid - Number(settlement.amount))
        const updatedDescJson = JSON.stringify({ ...parsed, paid_amount: revertedPaid })

        await supabase
            .from('expenses')
            .update({ description: updatedDescJson })
            .eq('id', expense.id)
    }
}
