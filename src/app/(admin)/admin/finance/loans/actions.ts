'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/loans'

// ── Loans (Loan Accounts) ────────────────────────────────────
export async function createLoanAction(input: { lender_name: string; principal_amount: number; interest_rate?: number; start_date: string; tenure_months?: number; notes?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage loans.' } }
    const lender_name = input.lender_name?.trim()
    if (!lender_name) return { error: 'Lender name is required.' }
    if (!Number.isFinite(input.principal_amount) || input.principal_amount <= 0) return { error: 'Principal amount must be a positive number.' }
    if (!input.start_date) return { error: 'Start date is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('loans')
        .insert({
            lender_name,
            principal_amount: input.principal_amount,
            interest_rate: input.interest_rate ?? null,
            start_date: input.start_date,
            tenure_months: input.tenure_months ?? null,
            notes: input.notes?.trim() || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateLoanStatusAction(id: string, status: 'active' | 'closed') {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage loans.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('loans').update({ status }, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Loan not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteLoanAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage loans.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('loans').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Loan not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Loan EMI Schedule ────────────────────────────────────────
export async function createLoanEmiAction(input: { loan_id: string; installment_no: number; due_date: string; amount: number }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage the EMI schedule.' } }
    if (!input.loan_id) return { error: 'A loan is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.due_date) return { error: 'Due date is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('loan_emi_schedule')
        .insert({
            loan_id: input.loan_id,
            installment_no: input.installment_no,
            due_date: input.due_date,
            amount: input.amount,
            restaurant_id: user.restaurantId,
        })
        .select('*, loans(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateLoanEmiStatusAction(id: string, status: 'pending' | 'paid' | 'overdue') {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage the EMI schedule.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('loan_emi_schedule').update({ status }, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Installment not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteLoanEmiAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage the EMI schedule.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('loan_emi_schedule').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Installment not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Loan Payments ────────────────────────────────────────────
export async function createLoanPaymentAction(input: { loan_id: string; amount: number; principal_component?: number; interest_component?: number; payment_date?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage loan payments.' } }
    if (!input.loan_id) return { error: 'A loan is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('loan_payments')
        .insert({
            loan_id: input.loan_id,
            amount: input.amount,
            principal_component: input.principal_component ?? null,
            interest_component: input.interest_component ?? null,
            payment_date: input.payment_date || new Date().toISOString().slice(0, 10),
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, loans(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteLoanPaymentAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage loan payments.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('loan_payments').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Payment not found.' }
    revalidatePath(PATH)
    return { success: true }
}
