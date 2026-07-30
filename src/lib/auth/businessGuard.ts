import { createAdminClient } from '@/lib/supabase/server'
import { resolveActiveDayBookSession } from '@/lib/ledger'

export async function isBusinessOpen(restaurantId: string): Promise<boolean> {
    if (!restaurantId) return false
    const supabase = await createAdminClient()
    const activeSession = await resolveActiveDayBookSession(supabase, restaurantId)
    return !!activeSession && activeSession.status === 'open'
}

export async function assertBusinessOpen(restaurantId: string): Promise<{ allowed: boolean; error?: string }> {
    const open = await isBusinessOpen(restaurantId)
    if (!open) {
        return {
            allowed: false,
            error: 'Business day is closed. A cashier or manager must open the business day before performing this action.'
        }
    }
    return { allowed: true }
}
