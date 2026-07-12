'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
    TAKEOUT_ORDER_SELECT,
    TAKEOUT_STATUS_TO_ORDER,
    mapOrderRowToTakeout,
    type TakeoutOrderRow,
    type OrderStatus,
} from '@/lib/takeout'
import { requireRole } from '@/lib/auth'

// Used by both the admin Takeout dashboard (manager/super_admin) and the
// Cashier/Waiter panel's takeaway tab (cashier/waiter) - matches the role set
// already required to load /cashier (see (staff)/cashier/page.tsx).
export async function updateTakeoutStatusAction(orderId: string, newStatus: string) {
    await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    const orderStatus: OrderStatus =
        TAKEOUT_STATUS_TO_ORDER[newStatus as keyof typeof TAKEOUT_STATUS_TO_ORDER] ?? 'pending'

    const timestamps: Record<string, string> = {}
    const now = new Date().toISOString()
    if (orderStatus === 'confirmed') timestamps.confirmed_at = now
    if (orderStatus === 'ready') timestamps.ready_at = now
    if (orderStatus === 'delivered') timestamps.delivered_at = now

    const { error } = await supabase
        .from('orders')
        .update({ status: orderStatus, ...timestamps })
        .eq('id', orderId)
        .in('order_type', ['takeout', 'delivery'])

    if (error) return { error: error.message }
    revalidatePath('/admin/takeout')
    revalidatePath('/kitchen')
    revalidatePath('/waiter')
    return { success: true }
}

export async function getTakeoutOrdersAction(restaurantId: string) {
    await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('orders')
        .select(TAKEOUT_ORDER_SELECT)
        .eq('restaurant_id', restaurantId)
        .in('order_type', ['takeout', 'delivery'])
        // active = not picked up / cancelled
        .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
        .order('placed_at', { ascending: false })
        .limit(50)

    return { data: ((data || []) as unknown as TakeoutOrderRow[]).map(mapOrderRowToTakeout) }
}
