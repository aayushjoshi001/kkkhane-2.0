import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import ExpensesManager from './ExpensesManager'

export const revalidate = 0

export default async function FinanceExpensesPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: categories }, { data: expenses }] = await Promise.all([
        supabase.from('expense_categories').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('expenses').select('*, expense_categories(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return <ExpensesManager initialCategories={categories || []} initialExpenses={expenses || []} />
}
