import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import VouchersManager from './VouchersManager'

export const dynamic = 'force-dynamic'

export default async function VouchersPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    // Fetch active bank accounts and all day book entries containing vouchers in parallel
    const [
        { data: bankAccounts },
        { data: voucherEntries }
    ] = await Promise.all([
        supabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('day_book_entries')
            .select('*, day_book_sessions(date)')
            .eq('restaurant_id', restaurantId)
            .like('description', '{"voucher_type"%')
            .order('created_at', { ascending: false })
    ])

    return (
        <VouchersManager
            bankAccounts={bankAccounts || []}
            initialEntries={voucherEntries || []}
        />
    )
}
