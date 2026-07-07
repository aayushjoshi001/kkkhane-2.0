import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import ReceivablesManager from './ReceivablesManager'

export const revalidate = 0

export default async function FinanceReceivablesPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: accounts }, { data: transactions }] = await Promise.all([
        supabase.from('customer_credit_accounts').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
        supabase.from('receivable_transactions').select('*, customer_credit_accounts(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return <ReceivablesManager initialAccounts={accounts || []} initialTransactions={transactions || []} />
}
