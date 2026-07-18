import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ReportsViewer from './ReportsViewer'

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
            <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-h2 font-extrabold text-ink">End-of-Day Reports</h1>
                    <p className="text-ink-subtle font-medium mt-1">Generate and view daily operational summaries</p>
                </div>
            </header>
            <ReportsViewer initialReports={reports || []} restaurantId={rid} />
        </div>
    )
}
