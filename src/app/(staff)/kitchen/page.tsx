import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import OrderQueue, { type KitchenOrder, type ComboItemRow } from '@/components/kitchen/OrderQueue'
import TakeoutQueue from '@/components/kitchen/TakeoutQueue'
import KitchenStats from '@/components/kitchen/KitchenStats'
import StaffShiftClock from '@/components/shared/StaffShiftClock'
import { getRestaurantFeatures } from '@/lib/features'
import { TAKEOUT_ORDER_SELECT, mapOrderRowToTakeout, type TakeoutOrderRow } from '@/lib/takeout'

export const revalidate = 0

export default async function KitchenPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
        features,
        { data: activeOrders },
        { data: takeoutOrders },
        { count: completedToday },
        { data: activeShift },
        { data: shiftHistory },
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        // Include 'ready' so kitchen can see the pass column
        adminSupabase
            .from('orders')
            .select(`
                id,
                status,
                total_amount,
                placed_at,
                customer_note,
                sessions ( tables ( label ) ),
                order_items (
                    id,
                    menu_item_id,
                    quantity,
                    special_request,
                    status,
                    claimed_by,
                    claimed_at,
                    menu_items ( name, is_combo ),
                    order_item_modifiers ( modifier_name, price_adjustment )
                )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('order_type', 'dine_in')
            .eq('needs_confirmation', false)
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),
        adminSupabase
            .from('orders')
            .select(TAKEOUT_ORDER_SELECT)
            .eq('restaurant_id', restaurantId)
            .eq('order_type', 'takeout')
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('pickup_time', { ascending: true }),
        // Orders completed (delivered) today
        adminSupabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId)
            .eq('status', 'delivered')
            .gte('placed_at', today.toISOString()),
        // Active shift for clock widget
        adminSupabase
            .from('staff_shifts')
            .select('*')
            .eq('user_id', userId)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1)
            .maybeSingle(),
        // Recent shift history
        adminSupabase
            .from('staff_shifts')
            .select('*')
            .eq('user_id', userId)
            .not('clock_out', 'is', null)
            .order('clock_in', { ascending: false })
            .limit(5),
    ])

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

    // Kitchen stats for the top bar
    const queuedOrders = (activeOrders || []).filter(o => o.status === 'pending' || o.status === 'confirmed').length
    const preparingOrders = (activeOrders || []).filter(o => o.status === 'preparing').length
    const readyOrders = (activeOrders || []).filter(o => o.status === 'ready').length

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Kitchen Stats — always-visible at-a-glance bar */}
            <div className="shrink-0 border-b border-dark-border px-3 md:px-6 py-3 md:py-4 bg-dark-surface print:hidden">
                <KitchenStats
                    queuedOrders={queuedOrders}
                    preparingOrders={preparingOrders}
                    readyOrders={readyOrders}
                    completedToday={completedToday || 0}
                    restaurantId={restaurantId}
                />
            </div>

            {/* Shift clock — only shown when staffShiftsEnabled */}
            {features?.staffShiftsEnabled && (
                <div className="px-4 pt-4 shrink-0 print:hidden w-full max-w-xs">
                    <StaffShiftClock
                        userId={userId}
                        restaurantId={restaurantId}
                        initialShift={activeShift || null}
                        initialHistory={shiftHistory || []}
                        dark
                    />
                </div>
            )}

            {/* Order Queue and Takeout */}
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
                <div className="flex-1 overflow-hidden">
                    <OrderQueue
                        initialOrders={(activeOrders || []) as unknown as KitchenOrder[]}
                        restaurantId={restaurantId}
                        comboItems={comboItems}
                        userId={userId}
                        staffNames={staffNames}
                    />
                </div>

                {features?.takeoutEnabled && (
                    <div className="px-4 pb-4 shrink-0 print:hidden">
                        <TakeoutQueue
                            initialOrders={((takeoutOrders || []) as unknown as TakeoutOrderRow[]).map(mapOrderRowToTakeout)}
                            restaurantId={restaurantId}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
