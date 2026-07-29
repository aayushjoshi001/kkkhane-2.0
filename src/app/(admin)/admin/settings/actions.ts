'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import type { BusinessHours } from '@/types/database'
import { requireRole } from '@/lib/auth'

export async function updateRestaurantSettingsAction(restaurantId: string, updates: Record<string, unknown>) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    // Columns that actually exist on the restaurants table.
    const safeUpdates: Record<string, unknown> = {
        name: updates.name,
        contact_phone: updates.contact_phone,
        contact_email: updates.contact_email,
        address: updates.address,
        logo_url: updates.logo_url,
        pan_number: updates.pan_number,
        vat_registered: updates.vat_registered,
        vat_number: updates.vat_number,
        ird_api_url: updates.ird_api_url,
        ird_api_user: updates.ird_api_user,
        ird_api_password: updates.ird_api_password,
        payment_qr_url: updates.payment_qr_url,
        payment_qr_label: updates.payment_qr_label,
        qr_bank_account_id: updates.qr_bank_account_id === '' ? null : updates.qr_bank_account_id,
        allowed_ips: updates.allowed_ips,
        business_type: updates.business_type,
    }

    // Strip undefined values
    const cleanUpdates = Object.fromEntries(
        Object.entries(safeUpdates).filter(([, v]) => v !== undefined)
    )

    if (Object.keys(cleanUpdates).length > 0) {
        const { error } = await supabase
            .from('restaurants')
            .update(cleanUpdates)
            .eq('id', restaurantId)
        if (error) return { error: error.message }
    }

    // tax_rate / currency / currency_symbol live in settings.features_v2
    // (defaultTaxRate / currency / currencySymbol) — merge them in, don't write
    // them to the restaurants table (those columns don't exist there).
    const featurePatch: Record<string, unknown> = {}
    if (updates.tax_rate !== undefined) featurePatch.defaultTaxRate = Number(updates.tax_rate)
    if (updates.currency !== undefined) featurePatch.currency = updates.currency
    if (updates.currency_symbol !== undefined) featurePatch.currencySymbol = updates.currency_symbol

    if (Object.keys(featurePatch).length > 0) {
        const { data: settingsRow } = await supabase
            .from('settings')
            .select('features_v2')
            .eq('restaurant_id', restaurantId)
            .maybeSingle()

        const merged = { ...(settingsRow?.features_v2 as Record<string, unknown> ?? {}), ...featurePatch }
        const { error: featError } = await supabase
            .from('settings')
            .update({ features_v2: merged })
            .eq('restaurant_id', restaurantId)
        if (featError) return { error: featError.message }
    }

    // Revalidate multiple paths since restaurant settings (like name/logo) 
    // likely affect the whole app layout and public menu pages
    revalidatePath('/', 'layout')

    // Instantly purge the allowed IP cache tag
    revalidateTag(`restaurant-allowed-ips-${restaurantId}`, 'max')

    return { success: true }
}

export async function updateBusinessHoursAction(restaurantId: string, businessHours: BusinessHours) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('settings')
        .update({ business_hours: businessHours })
        .eq('restaurant_id', restaurantId)
    if (error) return { error: error.message }

    revalidatePath('/', 'layout')
    return { success: true }
}

// A restaurant may run several payment QR codes (different providers, each
// depositing into a different bank account) — these actions manage that list.
// See supabase/migrations/20260710050000_payment_qr_codes.sql.

export async function createQrCodeAction(restaurantId: string, input: { label: string; image_url: string | null; bank_account_id: string | null }) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('payment_qr_codes')
        .insert({
            restaurant_id: restaurantId,
            label: input.label,
            image_url: input.image_url,
            bank_account_id: input.bank_account_id,
        })
        .select()
        .single()
    if (error) return { error: error.message }

    revalidatePath('/admin/settings')
    return { success: true, data }
}

export async function updateQrCodeAction(id: string, restaurantId: string, input: { label?: string; image_url?: string | null; bank_account_id?: string | null; is_active?: boolean }) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('payment_qr_codes')
        .update(input)
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
    if (error) return { error: error.message }

    revalidatePath('/admin/settings')
    return { success: true }
}

export async function deleteQrCodeAction(id: string, restaurantId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('payment_qr_codes')
        .delete()
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
    if (error) return { error: error.message }

    revalidatePath('/admin/settings')
    return { success: true }
}
