import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BudgetManager from './BudgetManager'

export const revalidate = 0

export default async function FinanceBudgetPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: budgets }, { data: categories }, { data: lines }] = await Promise.all([
        supabase.from('budgets').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
        supabase.from('budget_categories').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('budget_lines').select('*, budget_categories(*), budgets(name)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return <BudgetManager initialBudgets={budgets || []} initialCategories={categories || []} initialLines={lines || []} />
}
