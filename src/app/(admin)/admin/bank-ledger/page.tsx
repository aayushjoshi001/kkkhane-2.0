import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BankLedgerManager from './BankLedgerManager'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function BankLedgerPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    // Fetch active bank accounts and all bank ledger entries in parallel
    const [
        { data: bankAccounts },
        { data: bankEntries }
    ] = await Promise.all([
        supabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('day_book_entries')
            .select('*, day_book_sessions(date)')
            .eq('restaurant_id', restaurantId)
            .in('type', ['bank_in', 'bank_out'])
            .order('created_at', { ascending: false })
    ])

    const filteredBankEntries = (bankEntries || []).filter(e => {
        try {
            if (e.description.startsWith('{')) {
                const parsed = JSON.parse(e.description)
                if (parsed.status === 'pending_approval') return false
            }
        } catch {}
        return true
    })

    return (
        <BankLedgerManager
            bankAccounts={bankAccounts || []}
            bankEntries={filteredBankEntries}
        />
    )
}
