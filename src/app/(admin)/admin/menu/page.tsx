import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import MenuManager from '@/components/admin/MenuManager'
import EnableNepaliButton from '@/components/admin/EnableNepaliButton'

export const dynamic = 'force-dynamic'

export default async function MenuManagementPage() {
    const { restaurantId } = await getCurrentUser()

    const adminSupabase = await createAdminClient()

    const [{ data: categories }, { data: items }, { data: langs }, { data: ingredients }] = await Promise.all([
        adminSupabase
            .from('menu_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('sort_order', { ascending: true }),
        adminSupabase
            .from('menu_items')
            .select('*, variations:menu_item_variations(*)')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        adminSupabase
            .from('supported_languages')
            .select('language_code')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true),
        adminSupabase
            .from('ingredients')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
    ])

    const hasNepali = langs?.some(l => l.language_code === 'ne') ?? false

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-start">
                <header>
                    <h1 className="text-2xl font-bold text-gray-900">Menu Management</h1>
                    <p className="text-gray-500 mt-1">Organize your categories and menu items</p>
                </header>
                {!hasNepali && <EnableNepaliButton />}
            </div>

            <MenuManager
                initialCategories={categories || []}
                initialItems={items || []}
                initialIngredients={ingredients || []}
                restaurantId={restaurantId}
            />
        </div>
    )
}
