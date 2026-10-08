import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import HomepageManager from '@/components/admin/HomepageManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Globe } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function HomepagePage() {
    const { restaurantId, role } = await getCurrentUser()

    if (role !== 'manager' && role !== 'super_admin') {
        redirect('/unauthorized')
    }

    const adminSupabase = await createAdminClient()

    // Fetch the restaurant to verify it exists
    const { data: restaurant, error } = await adminSupabase
        .from('restaurants')
        .select('id, name')
        .eq('id', restaurantId)
        .single()

    if (!restaurant || error) {
        redirect('/unauthorized')
    }

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Homepage Manager" description="Customize your restaurant's homepage that customers see when they scan the QR code." icon={<Globe size={18} />} color="orange" />

            <div>
                <HomepageManager restaurantId={restaurantId} />
            </div>
        </div>
    )
}
