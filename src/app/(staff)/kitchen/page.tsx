import RealtimeCatchUp from '@/components/shared/RealtimeCatchUp'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import OrderQueue, { type KitchenOrder, type ComboItemRow } from '@/components/kitchen/OrderQueue'
import { getRestaurantFeatures, getRestaurantName } from '@/lib/features'

export const revalidate = 0

export default async function KitchenPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const [
        features,
        restaurantName,
        { data: activeOrders },
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        getRestaurantName(restaurantId),
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
                booking_id,
                bookings:booking_id (
                  id,
                  rooms:room_id ( id, room_number )
                ),
                sessions (
                  id,
                  seat_number,
                  booking_id,
                  tables:table_id (
                    id,
                    label,
                    room_id,
                    rooms:room_id ( id, room_number ),
                    sessions ( id, seat_number, status )
                  )
                ),
                order_items (
                    id,
                    menu_item_id,
                    quantity,
                    unit_price,
                    special_request,
                    status,
                    claimed_by, claimed_at,
                    menu_items ( name, is_combo ),
                    menu_item_variations:menu_item_variation_id ( id, name ),
                    order_item_modifiers ( modifier_name, price_adjustment )
                )
            `)
            .eq('restaurant_id', restaurantId)
            .in('order_type', ['dine_in', 'takeout', 'delivery'])
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),
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
        <div className="h-full flex flex-col overflow-hidden bg-canvas">
            <RealtimeCatchUp restaurantId={restaurantId} />
            {/* Order Queue */}
            <div className="flex-1 overflow-hidden">
                <OrderQueue
                    initialOrders={filteredActiveOrders as unknown as KitchenOrder[]}
                    restaurantId={restaurantId}
                    comboItems={comboItems}
                    userId={userId}
                    staffNames={staffNames}
                    restaurantName={restaurantName}
                />
            </div>
        </div>
    )
}
