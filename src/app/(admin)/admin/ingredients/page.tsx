import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import IngredientsManager from './IngredientsManager'

import { redirect } from 'next/navigation'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

export default async function AdminIngredientsPage() {
    const { restaurantId: rid } = await getCurrentUser()
    const features = await getRestaurantFeatures(rid)
    if (!features?.ingredientTrackingEnabled) {
        redirect('/admin/dashboard')
    }
    const adminSupabase = await createAdminClient()

    const [
        { data: ingredients },
        { data: categories },
        { data: suppliers },
        { data: bankAccounts }
    ] = await Promise.all([
        adminSupabase
            .from('ingredients')
            .select('*')
            .eq('restaurant_id', rid)
            .order('name', { ascending: true }),
        adminSupabase
            .from('expense_categories')
            .select('*')
            .eq('restaurant_id', rid)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        adminSupabase
            .from('suppliers')
            .select('*')
            .eq('restaurant_id', rid)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        adminSupabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', rid)
            .eq('is_active', true)
            .order('name', { ascending: true })
    ])

    return (
        <div className="space-y-6">
            <div className="bg-surface p-6 rounded-xl border border-hairline-strong shadow-sm">
                <h1 className="text-2xl font-bold text-ink">Stock</h1>
                <p className="text-ink-subtle mt-1">Track stock levels, costs and movements.</p>
            </div>
            <IngredientsManager
                initialIngredients={ingredients || []}
                restaurantId={rid}
                initialCategories={categories || []}
                initialSuppliers={suppliers || []}
                initialBankAccounts={bankAccounts || []}
            />
        </div>
    )
}
