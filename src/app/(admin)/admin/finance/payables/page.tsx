import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PayablesManager from './PayablesManager'

export const revalidate = 0

export default async function FinancePayablesPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: suppliers }, { data: bills }, { data: payments }] = await Promise.all([
        supabase.from('suppliers').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
        supabase.from('supplier_bills').select('*, suppliers(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
        supabase.from('supplier_payments').select('*, suppliers(*), supplier_bills(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
    ])

    return <PayablesManager initialSuppliers={suppliers || []} initialBills={bills || []} initialPayments={payments || []} />
}
