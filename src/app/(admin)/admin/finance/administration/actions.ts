'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/administration'

// ── Chart of Accounts ────────────────────────────────────────
export async function createAccountAction(input: { code: string; name: string; account_type: string; parent_id?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage the chart of accounts.' } }
    const code = input.code?.trim()
    const name = input.name?.trim()
    if (!code) return { error: 'Account code is required.' }
    if (!name) return { error: 'Account name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('chart_of_accounts')
        .insert({ code, name, account_type: input.account_type, parent_id: input.parent_id || null, restaurant_id: user.restaurantId, created_by: user.id })
        .select('*, parent:parent_id(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateAccountAction(id: string, updates: { is_active?: boolean }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage the chart of accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('chart_of_accounts').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteAccountAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage the chart of accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('chart_of_accounts').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Voucher Types ────────────────────────────────────────────
export async function createVoucherTypeAction(input: { name: string; voucher_category: string; prefix: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage voucher types.' } }
    const name = input.name?.trim()
    const prefix = input.prefix?.trim().toUpperCase()
    if (!name) return { error: 'Name is required.' }
    if (!prefix) return { error: 'Prefix is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('voucher_types')
        .insert({ name, voucher_category: input.voucher_category, prefix, restaurant_id: user.restaurantId, created_by: user.id })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteVoucherTypeAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage voucher types.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('voucher_types').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Voucher type not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Finance Payment Methods ──────────────────────────────────
export async function createFinancePaymentMethodAction(input: { name: string; category: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage payment methods.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('finance_payment_methods')
        .insert({ name, category: input.category, restaurant_id: user.restaurantId, created_by: user.id })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteFinancePaymentMethodAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage payment methods.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('finance_payment_methods').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Payment method not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Approval Levels ──────────────────────────────────────────
export async function createApprovalLevelAction(input: { name: string; level_order: number; min_amount: number; max_amount?: number; role_required: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage approval levels.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('approval_levels')
        .insert({
            name,
            level_order: input.level_order,
            min_amount: input.min_amount,
            max_amount: input.max_amount ?? null,
            role_required: input.role_required,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteApprovalLevelAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage approval levels.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('approval_levels').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Approval level not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Fiscal Years ──────────────────────────────────────────────
export async function createFiscalYearAction(input: { name: string; start_date: string; end_date: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage fiscal years.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Name is required.' }
    if (!input.start_date || !input.end_date) return { error: 'Start and end dates are required.' }
    if (input.end_date <= input.start_date) return { error: 'End date must be after the start date.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('fiscal_years')
        .insert({ name, start_date: input.start_date, end_date: input.end_date, restaurant_id: user.restaurantId })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function setCurrentFiscalYearAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage fiscal years.' } }
    const supabase = await createAdminClient()
    await supabase.from('fiscal_years').update({ is_current: false }).eq('restaurant_id', user.restaurantId)
    const { error, count } = await supabase.from('fiscal_years').update({ is_current: true }, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Fiscal year not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteFiscalYearAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage fiscal years.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('fiscal_years').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Fiscal year not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Accounting Periods ───────────────────────────────────────
export async function createAccountingPeriodAction(input: { fiscal_year_id: string; name: string; start_date: string; end_date: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage accounting periods.' } }
    if (!input.fiscal_year_id) return { error: 'A fiscal year is required.' }
    const name = input.name?.trim()
    if (!name) return { error: 'Name is required.' }
    if (input.end_date <= input.start_date) return { error: 'End date must be after the start date.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('accounting_periods')
        .insert({ fiscal_year_id: input.fiscal_year_id, name, start_date: input.start_date, end_date: input.end_date, restaurant_id: user.restaurantId })
        .select('*, fiscal_years(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateAccountingPeriodStatusAction(id: string, status: 'open' | 'closed') {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage accounting periods.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('accounting_periods').update({ status }, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Accounting period not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteAccountingPeriodAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage accounting periods.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('accounting_periods').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Accounting period not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Finance Settings (single row per restaurant) ─────────────
export async function updateFinanceSettingsAction(input: { base_currency: string; default_tax_rate: number; fiscal_year_start_month: number; rounding_mode: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage finance settings.' } }
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('finance_settings')
        .upsert({ restaurant_id: user.restaurantId, ...input }, { onConflict: 'restaurant_id' })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

// ── Finance Role Permissions (inert matrix) ──────────────────
export async function setFinanceRolePermissionAction(input: {
    role_name: string
    module: string
    can_view: boolean
    can_create: boolean
    can_edit: boolean
    can_delete: boolean
    can_approve: boolean
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage role permissions.' } }
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('finance_role_permissions')
        .upsert(
            { restaurant_id: user.restaurantId, created_by: user.id, ...input },
            { onConflict: 'restaurant_id,role_name,module' },
        )
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}
