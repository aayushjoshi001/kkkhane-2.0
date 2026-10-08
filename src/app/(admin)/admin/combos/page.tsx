import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CombosManager from './CombosManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Package } from 'lucide-react'

export const revalidate = 0

export default async function AdminCombosPage() {
    const { restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    // Fetch categories and standard items (non-combos)
    const [
        { data: categories },
        { data: allItems }
    ] = await Promise.all([
        adminSupabase
            .from('menu_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('sort_order', { ascending: true }),
        adminSupabase
            .from('menu_items')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true })
    ])

    // Split the single menu_items fetch into combos vs. standard items — no need for
    // a second query. Standard items exclude combos so a combo can't nest a combo.
    const combos = (allItems || []).filter(item => item.is_combo)
    const standardItems = (allItems || []).filter(item => !item.is_combo)

    // combo_items lives in its own table that may not exist on un-migrated DBs.
    let comboItems: { id: string; combo_id: string; item_id: string; quantity: number }[] = []
    let isDbReady = true
    let dbError = ''

    try {
        const { data: comboItemsData, error: itemsErr } = await adminSupabase
            .from('combo_items')
            // Scope to this restaurant's combos via the parent combo's restaurant_id.
            .select('id, combo_id, item_id, quantity, combo:menu_items!combo_id!inner(restaurant_id)')
            .eq('combo.restaurant_id', restaurantId)

        if (itemsErr) throw itemsErr
        comboItems = (comboItemsData || []).map(({ id, combo_id, item_id, quantity }) => ({ id, combo_id, item_id, quantity }))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('Combo Offers database tables or columns do not exist yet:', message)
        isDbReady = false
        dbError = message
    }

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Combo Offers" description="Bundle multiple menu items together and sell them at a special package price." icon={<Package size={18} />} color="orange" />

            <CombosManager
                initialCombos={combos}
                initialComboItems={comboItems}
                categories={categories || []}
                menuItems={standardItems}
                restaurantId={restaurantId}
                isDbReady={isDbReady}
                dbError={dbError}
            />
        </div>
    )
}
