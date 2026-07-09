import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import IncomeExpensesManager from './IncomeExpensesManager'

export const dynamic = 'force-dynamic'

export default async function IncomeExpensesPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    // Fetch categories and entries in parallel
    const [
        { data: incomeCategories },
        { data: expenseCategories },
        { data: incomeEntries },
        { data: expenses }
    ] = await Promise.all([
        supabase
            .from('income_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('expense_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('income_entries')
            .select('*, income_categories(*)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(200),
        supabase
            .from('expenses')
            .select('*, expense_categories(*)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(200)
    ])

    return (
        <IncomeExpensesManager
            initialIncomeCategories={incomeCategories || []}
            initialExpenseCategories={expenseCategories || []}
            initialIncomeEntries={incomeEntries || []}
            initialExpenses={expenses || []}
        />
    )
}
