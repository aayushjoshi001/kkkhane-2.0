import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import IngredientsManager from './IngredientsManager'

export const revalidate = 0

export default async function AdminIngredientsPage() {
    const { restaurantId: rid } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const { data: ingredients } = await adminSupabase
        .from('ingredients')
        .select('*')
        .eq('restaurant_id', rid)
        .order('name', { ascending: true })

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h1 className="text-2xl font-bold text-gray-900">Stock</h1>
                <p className="text-gray-500 mt-1">Track stock levels, costs and movements.</p>
            </div>
            <IngredientsManager initialIngredients={ingredients || []} restaurantId={rid} />
        </div>
    )
}
