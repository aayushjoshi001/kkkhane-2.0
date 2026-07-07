import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashManager from './CashManager'

export const revalidate = 0

export default async function FinanceCashPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: drawers }, { data: transactions }, { data: counts }] = await Promise.all([
        supabase.from('cash_drawers').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
        supabase.from('cash_transactions').select('*, cash_drawers(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
        supabase.from('cash_counts').select('*, cash_drawers(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return (
        <CashManager
            initialDrawers={drawers || []}
            initialTransactions={transactions || []}
            initialCounts={counts || []}
        />
    )
}
