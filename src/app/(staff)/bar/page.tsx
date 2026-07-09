import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import OrderQueue, { type KitchenOrder, type ComboItemRow } from '@/components/kitchen/OrderQueue'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

// The bar display: the same board as the kitchen, but OrderQueue projects each
// order down to its station='bar' lines and drops food-only orders. We fetch
// the identical order set the kitchen does — the projection happens client-side
// so an order with both food and drinks shows on both boards, each seeing only
// its own half.
export default async function BarPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const [
        features,
        { data: activeOrders },
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
                    station,
                    claimed_by, claimed_at,
                    menu_items ( name, is_combo ),
                    order_item_modifiers ( modifier_name, price_adjustment )
                )
            `)
            .eq('restaurant_id', restaurantId)
            .in('order_type', ['dine_in', 'takeout', 'delivery'])
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),
    ])

    // Same visibility filter the kitchen applies: hide dine-in orders still
    // awaiting waiter confirmation, and takeout/delivery orders not yet confirmed.
    const filteredActiveOrders = (activeOrders || []).filter(o => {
        if (o.order_type === 'dine_in') {
            return !o.needs_confirmation
        } else {
            return o.status !== 'pending'
        }
    })

    const { data: staff } = await adminSupabase
        .from('users')
        .select('id, full_name')
        .eq('restaurant_id', restaurantId)
    const staffNames: Record<string, string> = Object.fromEntries(
        (staff || []).map(s => [s.id, s.full_name as string])
    )

    let comboItems: ComboItemRow[] = []
    try {
        const { data: rawComboItems, error: comboErr } = await adminSupabase
            .from('combo_items')
            .select('id, combo_id, item_id, quantity, menu_items!item_id(name), combo:menu_items!combo_id!inner(restaurant_id)')
            .eq('combo.restaurant_id', restaurantId)
        if (comboErr) throw comboErr
        comboItems = (rawComboItems || []) as unknown as ComboItemRow[]
    } catch (err) {
        console.warn('Could not fetch combo_items in BarPage:', err)
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[#FBF7F3]">
            <div className="flex-1 overflow-hidden">
                <OrderQueue
                    station="bar"
                    initialOrders={filteredActiveOrders as unknown as KitchenOrder[]}
                    restaurantId={restaurantId}
                    comboItems={comboItems}
                    userId={userId}
                    staffNames={staffNames}
                />
            </div>
        </div>
    )
}
