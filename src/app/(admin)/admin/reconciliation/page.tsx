import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import ReconciliationClient from './ReconciliationClient'

export const dynamic = 'force-dynamic'

export default async function ReconciliationPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const myId = currentUser.restaurantId

    // 1. Parallel Stage 1: Fetch restaurant settings, categories, and audit logs
    const [
        { data: restaurant },
        { data: apCat },
        { data: arCat },
        { data: auditLogsRes }
    ] = await Promise.all([
        supabase.from('restaurants').select('*').eq('id', myId).single(),
        supabase.from('expense_categories').select('id').eq('restaurant_id', myId).eq('name', 'Accounts Payable to Restaurant').maybeSingle(),
        supabase.from('income_categories').select('id').eq('restaurant_id', myId).eq('name', 'Accounts Receivable from Hotel').maybeSingle(),
        supabase.from('cross_tenant_audit_logs').select('*').or(`actor_tenant_id.eq.${myId},target_tenant_id.eq.${myId}`).order('created_at', { ascending: false }).limit(30)
    ])

    if (!restaurant) {
        return <div className="p-8 text-center text-red-500">Restaurant not found.</div>
    }

    const partnerId = restaurant.linked_restaurant_id || restaurant.linked_hotel_id
    const auditLogs = auditLogsRes || []

    // 2. Parallel Stage 2: Fetch partner details, payables list, and receivables list concurrently
    const [partnerRes, payablesRes, receivablesRes] = await Promise.all([
        partnerId 
            ? supabase.from('restaurants').select('id, name, business_type, billing_commission_rate').eq('id', partnerId).maybeSingle()
            : Promise.resolve({ data: null }),
        apCat?.id
            ? supabase.from('expenses').select('*').eq('restaurant_id', myId).eq('category_id', apCat.id).order('created_at', { ascending: false })
            : Promise.resolve({ data: [] }),
        arCat?.id
            ? supabase.from('income_entries').select('*').eq('restaurant_id', myId).eq('category_id', arCat.id).order('created_at', { ascending: false })
            : Promise.resolve({ data: [] })
    ])

    const partner = partnerRes.data
    const payables = payablesRes.data || []
    const receivables = receivablesRes.data || []

    return (
        <ReconciliationClient
            restaurant={restaurant}
            partner={partner}
            payables={payables}
            receivables={receivables}
            auditLogs={auditLogs}
        />
    )
}
