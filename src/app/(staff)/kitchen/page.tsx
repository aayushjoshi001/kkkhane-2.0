import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import OrderQueue, { type KitchenOrder, type ComboItemRow } from '@/components/kitchen/OrderQueue'
import { getRestaurantFeatures } from '@/lib/features'
import TakeoutQueue from '@/components/kitchen/TakeoutQueue'
import { TAKEOUT_ORDER_SELECT, mapOrderRowToTakeout } from '@/lib/takeout'

export const revalidate = 0

export default async function KitchenPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const [
        features,
        { data: activeOrders },
        { data: takeoutOrders },
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        adminSupabase
            .from('orders')
            .select(`
                id,
                status,
                order_type,
                needs_confirmation,
                total_amount,
                placed_at,
                customer_note,
                sessions ( tables ( label ) ),
                order_items (
                    id,
                    menu_item_id,
                    quantity,
                    unit_price,
                    special_request,
                    status,
                    claimed_by,
                    claimed_at,
                    menu_items ( name, is_combo ),
                    order_item_modifiers ( modifier_name, price_adjustment )
                )
            `)
            .eq('restaurant_id', restaurantId)
            .in('order_type', ['dine_in', 'takeout', 'delivery'])
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),
        // Takeout Orders
        adminSupabase
            .from('orders')
            .select(TAKEOUT_ORDER_SELECT)
            .eq('restaurant_id', restaurantId)
            .in('order_type', ['takeout', 'delivery'])
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('pickup_time', { ascending: true }),
    ])

    // Filter active orders for the main kitchen queue:
    // 1. Dine-in orders that don't need confirmation.
    // 2. Takeout/delivery orders that are confirmed (status is confirmed, preparing, or ready).
    const filteredActiveOrders = (activeOrders || []).filter(o => {
        if (o.order_type === 'dine_in') {
            return !o.needs_confirmation
        } else {
            return o.status !== 'pending'
        }
    })

    // Names for per-dish chef ownership labels ("👤 Ram") on the cooking column.
    const { data: staff } = await adminSupabase
        .from('users')
        .select('id, full_name')
        .eq('restaurant_id', restaurantId)
    const staffNames: Record<string, string> = Object.fromEntries(
        (staff || []).map(s => [s.id, s.full_name as string])
    )

    // Fetch combo items safely (without breaking kitchen display if table is missing)
    let comboItems: ComboItemRow[] = []
    try {
        const { data: rawComboItems, error: comboErr } = await adminSupabase
            .from('combo_items')
            // Scope to this restaurant's combos (combo_items has no restaurant_id).
            .select('id, combo_id, item_id, quantity, menu_items!item_id(name), combo:menu_items!combo_id!inner(restaurant_id)')
            .eq('combo.restaurant_id', restaurantId)
        if (comboErr) throw comboErr
        comboItems = (rawComboItems || []) as unknown as ComboItemRow[]
    } catch (err) {
        console.warn('Could not fetch combo_items in KitchenPage:', err)
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[#FBF7F3]">
            {/* Order Queue and Takeout */}
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
                <div className="flex-1 overflow-hidden">
                    <OrderQueue
                        initialOrders={filteredActiveOrders as unknown as KitchenOrder[]}
                        restaurantId={restaurantId}
                        comboItems={comboItems}
                        userId={userId}
                        staffNames={staffNames}
                    />
                </div>
                
                {/* Takeout Queue at the bottom */}
                <div className="h-1/3 shrink-0 border-t border-gray-100 bg-white px-4 py-3">
                    <TakeoutQueue restaurantId={restaurantId} initialOrders={(takeoutOrders || []).map(mapOrderRowToTakeout)} />
                </div>
            </div>
        </div>
    )
}
