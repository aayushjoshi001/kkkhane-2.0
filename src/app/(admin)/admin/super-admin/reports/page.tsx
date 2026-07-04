import { requireRole } from '@/lib/auth'
import { getAllEodReportsAcrossRestaurants, getAllRestaurants } from '../actions'
import ReportsClient, { type Report } from './ReportsClient'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
    await requireRole('super_admin')

    const [reportsResult, restaurantsResult] = await Promise.all([
        getAllEodReportsAcrossRestaurants(200),
        getAllRestaurants(),
    ])

    const restaurants = (restaurantsResult.data || []).map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }))

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="EOD Reports" 
                description="End-of-day reports across all restaurant tenants." 
                icon={<FileText size={18} />}
                color="purple"
            />
            <ReportsClient reports={(reportsResult.data || []) as unknown as Report[]} restaurants={restaurants} />
        </div>
    )
}
