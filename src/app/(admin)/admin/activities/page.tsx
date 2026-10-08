import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import AuditManager from '../finance/audit/AuditManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Activity } from 'lucide-react'

export const revalidate = 0

export default async function ManagerActivitiesPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: logs } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(300)

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Activity Log" description="View and filter the full audit trail of all user actions in your restaurant." icon={<Activity size={18} />} color="orange" />
            <AuditManager logs={logs || []} />
        </div>
    )
}
