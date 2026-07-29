'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'

export async function addTableAction(restaurantId: string, label: string, capacity?: number) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    // Enforce plan table limit
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('max_tables')
        .eq('id', restaurantId)
        .single()

    const maxTables = (restaurant as { max_tables?: number } | null)?.max_tables ?? 999

    const { count: activeTableCount } = await supabase
        .from('tables')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)

    if ((activeTableCount ?? 0) >= maxTables) {
        return { error: `Table limit reached. Your plan allows ${maxTables} active tables.` }
    }

    // Generate a secure random token for the QR code
    const qrToken = crypto.randomUUID().split('-')[0] + '-' + Date.now().toString(36).slice(-4)

    const { data, error } = await supabase
        .from('tables')
        .insert({
            restaurant_id: restaurantId,
            label,
            capacity: capacity || null,
            qr_token: qrToken,
            is_active: true
        })
        .select()
        .single()

    if (error) return { error: error.message }

    revalidatePath('/admin/tables')
    // Keep the public ISR landing page (/r/[slug]) in sync after a table change.
    revalidatePath('/r/[restaurantSlug]', 'page')
    return { data }
}

export async function updateTableAction(id: string, updates: Record<string, unknown>) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { error } = await supabase
        .from('tables')
        .update(updates)
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/admin/tables')
    revalidatePath('/r/[restaurantSlug]', 'page')
    return { success: true }
}

export async function deleteTableAction(id: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    // Close (never delete) any still-active session on this table, so it
    // doesn't linger as "active" on a table that's no longer there. All
    // historical sessions/orders/order_items/payment_verifications/service_requests
    // are financial and tax records - they must survive the table being
    // removed, so nothing below ever deletes them. The table itself is only
    // ever soft-deleted (is_active: false), which is enough for it to
    // disappear from the active floor plan while every past order and
    // payment tied to it remains intact.
    await supabase
        .from('sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('table_id', id)
        .eq('status', 'active')

    const { error } = await supabase
        .from('tables')
        .update({ is_active: false })
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/admin/tables')
    revalidatePath('/r/[restaurantSlug]', 'page')
    return { success: true }
}
