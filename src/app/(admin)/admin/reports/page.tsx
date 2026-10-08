import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ReportsViewer from './ReportsViewer'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { FileText } from 'lucide-react'

export const revalidate = 0

export default async function AdminReportsPage() {
    const { restaurantId: rid } = await getCurrentUser()

    const { getRestaurantFeatures } = await import('@/lib/features')
    const features = await getRestaurantFeatures(rid)
    if (!features?.financeEnabled) {
        redirect('/admin/dashboard')
    }

    const adminSupabase = await createAdminClient()

    const { data: reports } = await adminSupabase
        .from('eod_reports')
        .select('*')
        .eq('restaurant_id', rid)
        .order('report_date', { ascending: false })
        .limit(30)

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="End-of-Day Reports" description="Generate and view daily operational summaries." icon={<FileText size={18} />} color="orange" />
            <ReportsViewer initialReports={reports || []} restaurantId={rid} />
        </div>
    )
}
