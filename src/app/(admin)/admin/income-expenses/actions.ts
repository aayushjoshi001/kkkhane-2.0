'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/income-expenses'

// ── Categories (Income & Expense) ───────────────────────────
export async function createCategoryAction(name: string, type: 'income' | 'expense', description?: string) {
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
            created_by: user.id
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

    // ── Check if there is an active Cash/Bank Book session open for today (in NST)
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

    let newEntryData: any = null

    if (input.type === 'income') {
        const { data, error } = await supabase
            .from('income_entries')
            .insert({
                category_id: input.category_id,
                amount: input.amount,
                description: input.description.trim(),
                restaurant_id: user.restaurantId,
                created_by: user.id
            })
            .select('*, income_categories(*)')
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
                approved_by: user.id,
                approved_at: new Date().toISOString(),
                restaurant_id: user.restaurantId,
                created_by: user.id
            })
            .select('*, expense_categories(*)')
            .single()

        if (error) return { error: error.message }
        newEntryData = data
    }

    // ── Auto-post matching entry to Day Book session if open
    if (openSession && newEntryData) {
        const dbType = input.type === 'income'
            ? (input.payment_source === 'cash' ? 'cash_in' : 'bank_in')
            : (input.payment_source === 'cash' ? 'cash_out' : 'bank_out')

        const dbCategory = input.type === 'income'
            ? (input.payment_source === 'cash' ? 'other' : 'deposit')
            : (input.payment_source === 'cash' ? 'expense' : 'transfer_out')

        const dbDescription = input.type === 'income'
            ? `[Income] ${input.description.trim()}`
            : `[Expense] ${input.description.trim()}` + (input.vendor_name?.trim() ? ` (Vendor: ${input.vendor_name.trim()})` : '')

        await supabase
            .from('day_book_entries')
            .insert({
                session_id: openSession.id,
                type: dbType,
                amount: input.amount,
                description: dbDescription,
                category: dbCategory,
                bank_name: input.payment_source === 'bank' ? input.bank_name?.trim() : null
            })
    }

    revalidatePath(PATH)
    // Also revalidate the cash/bank books path to reflect new auto-posted entries immediately!
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')

    return { data: newEntryData }
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

    revalidatePath(PATH)
    return { success: true }
}
