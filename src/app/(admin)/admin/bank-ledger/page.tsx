import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BankLedgerManager from './BankLedgerManager'

export const dynamic = 'force-dynamic'

export default async function BankLedgerPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

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

    return (
        <BankLedgerManager
            bankAccounts={bankAccounts || []}
            bankEntries={bankEntries || []}
        />
    )
}
