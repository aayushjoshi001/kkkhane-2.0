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

    // Check if active Day Book session is open for today (in NST timezone)
    const now = new Date()
    const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000
    const todayDateNst = new Date(now.getTime() + NST_OFFSET_MS).toISOString().split('T')[0]

    const { data: openSession } = await supabase
        .from('day_book_sessions')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('date', todayDateNst)
        .eq('status', 'open')
        .maybeSingle()

    return (
        <VouchersManager
            bankAccounts={bankAccounts || []}
            initialEntries={voucherEntries || []}
            suppliers={suppliers || []}
            staffList={staff || []}
            hasOpenSession={!!openSession}
        />
    )
}
