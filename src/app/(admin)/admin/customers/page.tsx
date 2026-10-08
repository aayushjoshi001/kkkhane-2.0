import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CustomersLedgerManager from './CustomersLedgerManager'
import { attachCreatorNames } from '@/lib/ledger'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Users } from 'lucide-react'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function CustomersLedgerPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

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

    const transactionsWithCreator = await attachCreatorNames(supabase, transactions || [])

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Customers Ledger" description="Track customer credit accounts and outstanding receivable balances." icon={<Users size={18} />} color="orange" />
            <CustomersLedgerManager initialAccounts={accounts || []} initialTransactions={transactionsWithCreator} />
        </div>
    )
}
