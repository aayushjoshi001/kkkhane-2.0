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

    // Fetch categories, entries, and suppliers in parallel
    const [
        { data: incomeCategories },
        { data: expenseCategories },
        { data: incomeEntries },
        { data: expenses },
        { data: suppliers }
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
            .limit(200),
        supabase
            .from('suppliers')
            .select('id, name')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true })
    ])

    return (
        <IncomeExpensesManager
            initialIncomeCategories={incomeCategories || []}
            initialExpenseCategories={expenseCategories || []}
            initialIncomeEntries={incomeEntries || []}
            initialExpenses={expenses || []}
            suppliers={suppliers || []}
        />
    )
}
