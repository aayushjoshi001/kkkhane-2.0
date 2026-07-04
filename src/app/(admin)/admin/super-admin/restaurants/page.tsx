import { requireRole } from '@/lib/auth'
import { getAllRestaurants, getSaasMetrics } from '../actions'
import SuperAdminDashboard from '../SuperAdminDashboard'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Building2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface Restaurant {
    id: string
    name: string
    slug: string
    is_active: boolean
    is_suspended: boolean
    subscription_tier: string
    subscription_status: string
    subscription_expires_at: string | null
    max_staff: number
    max_menu_items: number
    created_at: string
    users?: { email: string } | null
}

export default async function RestaurantsPage() {
    await requireRole('super_admin')

    const [restaurantsResult, metrics] = await Promise.all([
        getAllRestaurants(),
        getSaasMetrics(),
    ])

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Restaurants" 
                description="Create, suspend, and manage all restaurant tenants and their subscriptions." 
                icon={<Building2 size={18} />}
                color="purple"
            />

            <SuperAdminDashboard
                restaurants={(restaurantsResult.data || []) as Restaurant[]}
                metrics={metrics}
            />
        </div>
    )
}
