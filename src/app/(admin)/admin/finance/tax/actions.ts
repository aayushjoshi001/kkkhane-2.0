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

export async function calculateVatFilingSummaryAction(periodStart: string, periodEnd: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    // 1. Fetch restaurant registration details
    const { data: rest } = await supabase
        .from('restaurants')
        .select('vat_registered')
        .eq('id', user.restaurantId)
        .single()

    const vatRegistered = !!rest?.vat_registered

    // 2. Fetch sales (income entries)
    const { data: salesRows, error: salesErr } = await supabase
        .from('income_entries')
        .select('amount')
        .eq('restaurant_id', user.restaurantId)
        .gte('created_at', periodStart + 'T00:00:00.000Z')
        .lte('created_at', periodEnd + 'T23:59:59.999Z')

    if (salesErr) return { error: salesErr.message }

    // 3. Fetch purchases (expenses)
    const { data: expRows, error: expErr } = await supabase
        .from('expenses')
        .select('amount')
        .eq('restaurant_id', user.restaurantId)
        .gte('created_at', periodStart + 'T00:00:00.000Z')
        .lte('created_at', periodEnd + 'T23:59:59.999Z')

    if (expErr) return { error: expErr.message }

    const totalSales = (salesRows || []).reduce((s, r) => s + Number(r.amount), 0)
    const totalPurchases = (expRows || []).reduce((s, r) => s + Number(r.amount), 0)

    // Nepal standard VAT is 13% inclusive on standard retail transactions
    const vatRate = 13
    const outputVat = vatRegistered ? (totalSales - (totalSales / (1 + vatRate / 100))) : 0
    const inputVat = vatRegistered ? (totalPurchases - (totalPurchases / (1 + vatRate / 100))) : 0
    const netVat = outputVat - inputVat

    return {
        data: {
            vatRegistered,
            totalSales,
            taxableSales: totalSales - outputVat,
            outputVat,
            totalPurchases,
            taxablePurchases: totalPurchases - inputVat,
            inputVat,
            netVat
        }
    }
}

export async function getMonthlyVatDetailsAction(periodStart: string, periodEnd: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    // 1. Fetch sales
    const { data: sales, error: salesErr } = await supabase
        .from('income_entries')
        .select('created_at, amount, guest_name, description')
        .eq('restaurant_id', user.restaurantId)
        .gte('created_at', periodStart + 'T00:00:00.000Z')
        .lte('created_at', periodEnd + 'T23:59:59.999Z')
        .order('created_at', { ascending: true })

    if (salesErr) return { error: salesErr.message }

    // 2. Fetch purchases
    const { data: purchases, error: expErr } = await supabase
        .from('expenses')
        .select('created_at, amount, recipient, description, category:category_id(name)')
        .eq('restaurant_id', user.restaurantId)
        .gte('created_at', periodStart + 'T00:00:00.000Z')
        .lte('created_at', periodEnd + 'T23:59:59.999Z')
        .order('created_at', { ascending: true })

    if (expErr) return { error: expErr.message }

    return {
        data: {
            sales: (sales || []).map(s => {
                const total = Number(s.amount) || 0
                const vat = total - (total / 1.13)
                return {
                    date: s.created_at,
                    customerName: s.guest_name || 'Walk-in Guest',
                    description: s.description || 'Sales Transaction',
                    total,
                    taxable: total - vat,
                    vat
                }
            }),
            purchases: (purchases || []).map(p => {
                const total = Number(p.amount) || 0
                const vat = total - (total / 1.13)
                const categoryName = (p.category as any)?.name || 'General Expense'
                return {
                    date: p.created_at,
                    recipient: p.recipient || categoryName,
                    description: p.description || 'Stock/Purchase',
                    total,
                    taxable: total - vat,
                    vat
                }
            })
        }
    }
}
