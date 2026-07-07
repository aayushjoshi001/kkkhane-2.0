import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import LoansManager from './LoansManager'

export const revalidate = 0

export default async function FinanceLoansPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: loans }, { data: emiSchedule }, { data: payments }] = await Promise.all([
        supabase.from('loans').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
        supabase.from('loan_emi_schedule').select('*, loans(*)').eq('restaurant_id', restaurantId).order('due_date', { ascending: true }).limit(200),
        supabase.from('loan_payments').select('*, loans(*)').eq('restaurant_id', restaurantId).order('payment_date', { ascending: false }).limit(200),
    ])

    return <LoansManager initialLoans={loans || []} initialEmiSchedule={emiSchedule || []} initialPayments={payments || []} />
}
