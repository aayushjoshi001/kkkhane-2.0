import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import IncomeManager from './IncomeManager'

export const revalidate = 0

export default async function FinanceIncomePage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: categories }, { data: entries }] = await Promise.all([
        supabase.from('income_categories').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('income_entries').select('*, income_categories(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return <IncomeManager initialCategories={categories || []} initialEntries={entries || []} />
}
