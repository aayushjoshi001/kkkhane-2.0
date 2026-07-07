import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import AuditManager from './AuditManager'

export const revalidate = 0

export default async function FinanceAuditPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: logs } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(300)

    return <AuditManager logs={logs || []} />
}
