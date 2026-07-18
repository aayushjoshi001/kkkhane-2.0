'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser, requireRole } from '@/lib/auth'
import type { PrinterConfigRole, PrinterType, PaperWidth } from '@/types/database'

// What the admin form submits. restaurant_id is never trusted from the client —
// it's resolved server-side from the caller's session.
export interface PrinterInput {
    name: string
    printer_type: PrinterType
    ip_address: string | null
    port: number
    role: PrinterConfigRole
    paper_width: PaperWidth
    copies: number
    is_active: boolean
    is_default: boolean
}

function sanitize(input: PrinterInput): PrinterInput {
    const isNetwork = input.printer_type === 'network'
    return {
        name: (input.name ?? '').trim(),
        printer_type: input.printer_type,
        ip_address: isNetwork ? (input.ip_address ?? '').trim() || null : null,
        port: Math.min(65535, Math.max(1, Math.round(Number(input.port) || 9100))),
        role: input.role,
        paper_width: input.paper_width,
        copies: Math.min(9, Math.max(1, Math.round(Number(input.copies) || 1))),
        is_active: !!input.is_active,
        is_default: !!input.is_default,
    }
}

function validate(input: PrinterInput): string | null {
    if (input.name.length < 1 || input.name.length > 120) return 'Name must be 1–120 characters.'
    if (input.printer_type === 'network') {
        if (!input.ip_address) return 'A network printer needs an IP address.'
        // Loose IPv4 / hostname sanity check — QZ Tray does the real reachability test.
        const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
        const host = /^[a-zA-Z0-9.-]+$/
        if (!ipv4.test(input.ip_address) && !host.test(input.ip_address)) return 'Enter a valid IP address or hostname.'
        if (ipv4.test(input.ip_address) && input.ip_address.split('.').some((o) => Number(o) > 255)) return 'IP address octets must be 0–255.'
    }
    return null
}

// The partial unique index printers_one_default_per_role allows at most one
// default per (restaurant, role); clear the others first so promoting a new
// default never trips the constraint.
async function clearOtherDefaults(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    restaurantId: string,
    role: PrinterConfigRole,
    exceptId?: string
) {
    let query = supabase
        .from('printers')
        .update({ is_default: false })
        .eq('restaurant_id', restaurantId)
        .eq('role', role)
        .eq('is_default', true)
    if (exceptId) query = query.neq('id', exceptId)
    await query
}

export async function createPrinterAction(raw: PrinterInput) {
    await requireRole('manager', 'super_admin')
    const { restaurantId, id: userId } = await getCurrentUser()
    const input = sanitize(raw)
    const invalid = validate(input)
    if (invalid) return { error: invalid }

    const supabase = await createAdminClient()
    if (input.is_default) await clearOtherDefaults(supabase, restaurantId, input.role)

    const { error } = await supabase.from('printers').insert({
        ...input,
        restaurant_id: restaurantId,
        created_by: userId ?? null,
    })
    if (error) {
        if (error.code === '23505') return { error: 'A printer with this name already exists.' }
        return { error: error.message }
    }
    revalidatePath('/admin/printers')
    return { success: true }
}

export async function updatePrinterAction(id: string, raw: PrinterInput) {
    await requireRole('manager', 'super_admin')
    const { restaurantId } = await getCurrentUser()
    const input = sanitize(raw)
    const invalid = validate(input)
    if (invalid) return { error: invalid }

    const supabase = await createAdminClient()
    if (input.is_default) await clearOtherDefaults(supabase, restaurantId, input.role, id)

    const { error } = await supabase
        .from('printers')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
    if (error) {
        if (error.code === '23505') return { error: 'A printer with this name already exists.' }
        return { error: error.message }
    }
    revalidatePath('/admin/printers')
    return { success: true }
}

export async function deletePrinterAction(id: string) {
    await requireRole('manager', 'super_admin')
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()
    const { error } = await supabase
        .from('printers')
        .delete()
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
    if (error) return { error: error.message }
    revalidatePath('/admin/printers')
    return { success: true }
}
