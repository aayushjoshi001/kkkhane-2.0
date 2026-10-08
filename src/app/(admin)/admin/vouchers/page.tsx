import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import VouchersManager from './VouchersManager'
import { resolveActiveDayBookSession } from '@/lib/ledger'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { FileText } from 'lucide-react'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function VouchersPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    // Fetch active bank accounts, day book entries, suppliers, and staff in parallel
    const [
        { data: bankAccounts },
        { data: voucherEntries },
        { data: suppliers },
        { data: staff }
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
            .order('created_at', { ascending: false }),
        supabase
            .from('suppliers')
            .select('id, name')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('users')
            .select('id, full_name')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('full_name', { ascending: true })
    ])

    // The active Day Book session — open (even across midnight if not yet
    // closed), or auto-opened here carrying forward the last closed
    // session's balances. Only null the very first time this restaurant
    // ever uses the Day Book.
    const openSession = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Vouchers Ledger" description="Log receipt and payment vouchers, and manage cheque deposit approvals." icon={<FileText size={18} />} color="orange" />
            <VouchersManager
                bankAccounts={bankAccounts || []}
                initialEntries={voucherEntries || []}
                suppliers={suppliers || []}
                staffList={staff || []}
                hasOpenSession={!!openSession}
            />
        </div>
    )
}
