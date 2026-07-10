'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import type { BusinessHours } from '@/types/database'

export async function updateRestaurantSettingsAction(restaurantId: string, updates: Record<string, unknown>) {
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
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('settings')
        .update({ business_hours: businessHours })
        .eq('restaurant_id', restaurantId)
    if (error) return { error: error.message }

    revalidatePath('/', 'layout')
    return { success: true }
}
