'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { postFinancialTransaction, resolveBankAccountId, isCategoryOwned } from '@/lib/ledger'

async function requireManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/income-expenses'

// ── Categories (Income & Expense) ───────────────────────────
export async function createCategoryAction(name: string, type: 'income' | 'expense', description?: string, parentId?: string | null) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const trimmedName = name?.trim()
    if (!trimmedName) return { error: 'Category name is required.' }

    const supabase = await createAdminClient()
    const table = type === 'income' ? 'income_categories' : 'expense_categories'

    const { data, error } = await supabase
        .from(table)
        .insert({
            name: trimmedName,
            description: description?.trim() || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
            // income_categories has no parent_id column — only expense_categories
            // supports the main/subcategory grouping.
            ...(type === 'expense' ? { parent_id: parentId || null } : {}),
        })
        .select()
        .single()

    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteCategoryAction(id: string, type: 'income' | 'expense') {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()
    const table = type === 'income' ? 'income_categories' : 'expense_categories'

    const { error, count } = await supabase
        .from(table)
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)

    if (error) return { error: error.message }
    if (!count) return { error: 'Category not found.' }

    revalidatePath(PATH)
    return { success: true }
}

// ── Entries (Income & Expense) ──────────────────────────────
export async function createEntryAction(input: {
    type: 'income' | 'expense'
    category_id: string
    amount: number
    description: string
    vendor_name?: string
    payment_source: 'cash' | 'bank'
    bank_name?: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!input.category_id) return { error: 'A category is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }
    if (input.payment_source === 'bank' && !input.bank_name?.trim()) {
        return { error: 'Bank name is required when payment source is Bank.' }
    }

    const supabase = await createAdminClient()

    // Never write another restaurant's category id onto this restaurant's row.
    const categoryTable = input.type === 'income' ? 'income_categories' : 'expense_categories'
    if (!await isCategoryOwned(supabase, user.restaurantId, categoryTable, input.category_id)) {
        return { error: 'Category not found.' }
    }

    const bankAccountId = input.payment_source === 'bank'
        ? await resolveBankAccountId(supabase, user.restaurantId, input.bank_name)
        : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let newEntryData: any = null

    if (input.type === 'income') {
        const { data, error } = await supabase
            .from('income_entries')
            .insert({
                category_id: input.category_id,
                amount: input.amount,
                description: input.description.trim(),
                restaurant_id: user.restaurantId,
                bank_account_id: bankAccountId,
                created_by: user.id
            })
            .select('*, income_categories(*), bank_accounts(*)')
            .single()

        if (error) return { error: error.message }
        newEntryData = data
    } else {
        const { data, error } = await supabase
            .from('expenses')
            .insert({
                category_id: input.category_id,
                amount: input.amount,
                description: input.description.trim(),
                vendor_name: input.vendor_name?.trim() || null,
                status: 'paid', // Auto-approved and paid for simple tracking
                bank_account_id: bankAccountId,
                approved_by: user.id,
                approved_at: new Date().toISOString(),
                restaurant_id: user.restaurantId,
                created_by: user.id
            })
            .select('*, expense_categories(*), bank_accounts(*)')
            .single()

        if (error) return { error: error.message }
        newEntryData = data
    }

    // ── Auto-post matching entry to Day Book session if open.
    // The income/expense row is already saved, so this is reported as a
    // warning rather than failing the action — but never swallowed.
    let warning: string | undefined
    if (newEntryData) {
        const postResult = await postFinancialTransaction(supabase, user, {
            type: input.type === 'income'
                ? (input.payment_source === 'cash' ? 'cash_in' : 'bank_in')
                : (input.payment_source === 'cash' ? 'cash_out' : 'bank_out'),
            amount: input.amount,
            description: input.type === 'income'
                ? `[Income] ${input.description.trim()}`
                : `[Expense] ${input.description.trim()}` + (input.vendor_name?.trim() ? ` (Vendor: ${input.vendor_name.trim()})` : ''),
            category: input.type === 'income'
                ? (input.payment_source === 'cash' ? 'other' : 'deposit')
                : (input.payment_source === 'cash' ? 'expense' : 'transfer_out'),
            bankName: input.payment_source === 'bank' ? input.bank_name : null,
            // Stamp the source row on the Day Book entry so deleting the entry
            // here can take its Day Book side with it. Without the link the
            // cash_out survived the delete, and every correction (delete, re-enter)
            // left the Cash Book permanently ahead of Income & Expenses — which
            // then made the cashier's till read short and cost them a deduction
            // through shift-cash reconciliation.
            referenceId: (newEntryData as { id?: string } | null)?.id ?? null,
        })

        if (postResult.error) {
            console.error('Failed to post income/expense entry to Day Book:', postResult.error)
            warning = `Entry saved, but it could not be posted to the Day Book: ${postResult.error}`
        }
    }

    revalidatePath(PATH)
    // Also revalidate the cash/bank books path to reflect new auto-posted entries immediately!
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')

    return { data: newEntryData, warning }
}

export async function deleteEntryAction(id: string, type: 'income' | 'expense') {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()
    const table = type === 'income' ? 'income_entries' : 'expenses'

    const { error, count } = await supabase
        .from(table)
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)

    if (error) return { error: error.message }
    if (!count) return { error: 'Entry not found.' }

    // Take the Day Book side with it. Only entries this action posted carry the
    // row's id as reference_id, so nothing else is at risk; entries created
    // before this link existed have no reference_id and are left alone (they
    // have to be removed from the Day Book by hand).
    const { error: dbErr } = await supabase
        .from('day_book_entries')
        .delete()
        .eq('restaurant_id', user.restaurantId)
        .eq('reference_id', id)

    revalidatePath(PATH)
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    if (dbErr) {
        return { success: true, warning: `Entry deleted, but its Day Book entry could not be removed: ${dbErr.message}` }
    }
    return { success: true }
}
