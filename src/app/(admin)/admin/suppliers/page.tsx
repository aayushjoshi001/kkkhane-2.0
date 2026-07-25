import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import SuppliersLedgerManager from './SuppliersLedgerManager'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function SuppliersLedgerPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    // Fetch suppliers, expenses, expense categories, bank accounts, and ingredients in parallel
    const [
        { data: suppliers },
        { data: expenses },
        { data: expenseCategories },
        { data: bankAccounts },
        { data: ingredients }
    ] = await Promise.all([
        supabase
            .from('suppliers')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('expenses')
            .select('*, expense_categories(*), bank_accounts(*)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false }),
        supabase
            .from('expense_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('ingredients')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true })
    ])

    return (
        <SuppliersLedgerManager
            initialSuppliers={suppliers || []}
            expenses={expenses || []}
            expenseCategories={expenseCategories || []}
            bankAccounts={bankAccounts || []}
            ingredients={ingredients || []}
        />
    )
}
