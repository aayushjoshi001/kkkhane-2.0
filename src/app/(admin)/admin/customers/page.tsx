import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CustomersLedgerManager from './CustomersLedgerManager'

export const dynamic = 'force-dynamic'

export default async function CustomersLedgerPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    const [{ data: accounts }, { data: transactions }] = await Promise.all([
        supabase
            .from('customer_credit_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('customer_name', { ascending: true }),
        supabase
            .from('receivable_transactions')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false }),
    ])

    return <CustomersLedgerManager initialAccounts={accounts || []} initialTransactions={transactions || []} />
}
