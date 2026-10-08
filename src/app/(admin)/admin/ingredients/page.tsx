import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import IngredientsManager, { type IngredientMovementRow } from './IngredientsManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Boxes } from 'lucide-react'

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
        { data: bankAccounts },
        { data: movements },
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
            .order('name', { ascending: true }),
        // Inventory Activities — who moved stock, when, on what item, scoped
        // to this restaurant by filtering through the ingredient it belongs
        // to (ingredient_movements itself carries no restaurant_id).
        adminSupabase
            .from('ingredient_movements')
            .select('id, movement_type, quantity, notes, created_at, ingredients!inner(id, name, unit, restaurant_id), users(full_name)')
            .eq('ingredients.restaurant_id', rid)
            .order('created_at', { ascending: false })
            .limit(300),
    ])

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Stock" description="Track ingredient levels, costs, and movements across your kitchen." icon={<Boxes size={18} />} color="orange" />
            <IngredientsManager
                initialIngredients={ingredients || []}
                restaurantId={rid}
                initialCategories={categories || []}
                initialSuppliers={suppliers || []}
                initialBankAccounts={bankAccounts || []}
                initialMovements={(movements || []) as unknown as IngredientMovementRow[]}
            />
        </div>
    )
}
