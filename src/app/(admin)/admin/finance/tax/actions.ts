'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/tax'

// ── Tax Configurations ───────────────────────────────────────
export async function createTaxConfigurationAction(input: { name: string; tax_type: string; rate_percent?: number }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage tax configurations.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('tax_configurations')
        .insert({ name, tax_type: input.tax_type, rate_percent: input.rate_percent ?? null, restaurant_id: user.restaurantId, created_by: user.id })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateTaxConfigurationAction(id: string, updates: { name?: string; rate_percent?: number; is_active?: boolean }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage tax configurations.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('tax_configurations').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Tax configuration not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteTaxConfigurationAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage tax configurations.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('tax_configurations').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Tax configuration not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Tax Filings ───────────────────────────────────────────────
export async function createTaxFilingAction(input: { tax_configuration_id: string; period_start: string; period_end: string; ird_reference?: string; notes?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage tax filings.' } }
    if (!input.tax_configuration_id) return { error: 'A tax configuration is required.' }
    if (!input.period_start || !input.period_end) return { error: 'Period start and end are required.' }
    if (input.period_end < input.period_start) return { error: 'Period end must be on or after the start.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('tax_filings')
        .insert({
            tax_configuration_id: input.tax_configuration_id,
            period_start: input.period_start,
            period_end: input.period_end,
            ird_reference: input.ird_reference?.trim() || null,
            notes: input.notes?.trim() || null,
            restaurant_id: user.restaurantId,
        })
        .select('*, tax_configurations(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function markTaxFilingFiledAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage tax filings.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('tax_filings')
        .update({ status: 'filed', filed_by: user.id, filed_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Tax filing not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteTaxFilingAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage tax filings.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('tax_filings').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Tax filing not found.' }
    revalidatePath(PATH)
    return { success: true }
}
