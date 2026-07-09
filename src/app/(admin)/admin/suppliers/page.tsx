import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import SuppliersLedgerManager from './SuppliersLedgerManager'

export const dynamic = 'force-dynamic'

export default async function SuppliersLedgerPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    // Fetch suppliers and expenses in parallel
    const [
        { data: suppliers },
        { data: expenses }
    ] = await Promise.all([
        supabase
            .from('suppliers')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('expenses')
            .select('*, expense_categories(*)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
    ])

    return (
        <SuppliersLedgerManager
            initialSuppliers={suppliers || []}
            expenses={expenses || []}
        />
    )
}
