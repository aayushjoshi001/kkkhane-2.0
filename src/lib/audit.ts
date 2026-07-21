'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

export type AuditAction =
    | 'payment_verified'
    | 'payment_rejected'
    | 'order_status_changed'
    | 'order_delivered'
    | 'order_cancelled'
    | 'order_confirmed'
    | 'order_rejected'
    | 'order_items_confirmed'
    | 'order_item_removed'
    | 'session_opened'
    | 'session_closed'
    | 'menu_item_toggled'
    | 'menu_item_price_changed'
    | 'staff_invited'
    | 'staff_invite_accepted'
    | 'staff_removed'
    | 'shift_corrected'
    | 'report_generated'
    | 'booking_checked_out'
    | 'table_session_checked_out'
    | 'order_checked_out'
    | 'financial_event_created'
    | 'financial_event_status_changed'
    | 'financial_event_retried'
    | 'voucher_deleted'

async function getIp(): Promise<string | null> {
    try {
        const h = await headers()
        return (
            h.get('x-forwarded-for')?.split(',')[0].trim() ||
            h.get('x-real-ip') ||
            null
        )
    } catch {
        return null
    }
}

/**
 * Fire-and-forget audit log insert.
 * Never throws — logging failures must never block the primary operation.
 */
export async function logAudit(params: {
    restaurantId: string
    userId?: string | null
    action: AuditAction
    entityType: string
    entityId?: string | null
    oldValue?: Record<string, unknown> | null
    newValue?: Record<string, unknown> | null
}): Promise<void> {
    try {
        const ip = await getIp()
        const supabase = await createAdminClient()
        await supabase.from('audit_logs').insert({
            restaurant_id: params.restaurantId,
            user_id: params.userId ?? null,
            action: params.action,
            entity_type: params.entityType,
            entity_id: params.entityId ?? null,
            old_value: params.oldValue ?? null,
            new_value: params.newValue ?? null,
            ip_address: ip,
        })
    } catch {
        // Intentionally silent — audit failure must never surface to the user
    }
}
