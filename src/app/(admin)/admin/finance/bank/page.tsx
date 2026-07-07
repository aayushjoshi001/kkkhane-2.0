import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BankManager from './BankManager'

export const revalidate = 0

export default async function FinanceBankPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: accounts }, { data: transactions }, { data: reconciliations }] = await Promise.all([
        supabase.from('bank_accounts').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
        supabase.from('bank_transactions').select('*, bank_accounts(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
        supabase.from('bank_reconciliations').select('*, bank_accounts(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return (
        <BankManager
            initialAccounts={accounts || []}
            initialTransactions={transactions || []}
            initialReconciliations={reconciliations || []}
        />
    )
}
