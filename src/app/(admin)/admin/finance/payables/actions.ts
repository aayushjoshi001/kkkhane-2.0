'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/payables'

// ── Suppliers (master) ───────────────────────────────────────
export async function createSupplierAction(input: { name: string; contact_person?: string; phone?: string; email?: string; address?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage suppliers.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Supplier name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('suppliers')
        .insert({
            name,
            contact_person: input.contact_person?.trim() || null,
            phone: input.phone?.trim() || null,
            email: input.email?.trim() || null,
            address: input.address?.trim() || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateSupplierAction(id: string, updates: Record<string, unknown>) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage suppliers.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('suppliers').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Supplier not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteSupplierAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage suppliers.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('suppliers').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Supplier not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Supplier Bills ────────────────────────────────────────────
export async function createSupplierBillAction(input: { supplier_id: string; bill_number?: string; amount: number; description?: string; due_date?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage supplier bills.' } }
    if (!input.supplier_id) return { error: 'A supplier is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('supplier_bills')
        .insert({
            supplier_id: input.supplier_id,
            bill_number: input.bill_number?.trim() || null,
            amount: input.amount,
            description: input.description?.trim() || null,
            due_date: input.due_date || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, suppliers(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteSupplierBillAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage supplier bills.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('supplier_bills').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Bill not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Supplier Payments ─────────────────────────────────────────
export async function createSupplierPaymentAction(input: { supplier_id: string; bill_id?: string; amount: number; description?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage supplier payments.' } }
    if (!input.supplier_id) return { error: 'A supplier is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('supplier_payments')
        .insert({
            supplier_id: input.supplier_id,
            bill_id: input.bill_id || null,
            amount: input.amount,
            description: input.description?.trim() || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, suppliers(*), supplier_bills(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteSupplierPaymentAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage supplier payments.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('supplier_payments').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Payment not found.' }
    revalidatePath(PATH)
    return { success: true }
}
