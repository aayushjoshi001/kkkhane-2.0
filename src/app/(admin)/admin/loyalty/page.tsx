import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import LoyaltyManager from './LoyaltyManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Heart } from 'lucide-react'

import { redirect } from 'next/navigation'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

export default async function AdminLoyaltyPage() {
    const { restaurantId: rid } = await getCurrentUser()
    const features = await getRestaurantFeatures(rid)
    if (!features?.loyaltyEnabled) {
        redirect('/admin/dashboard')
    }
    const adminSupabase = await createAdminClient()

    const [{ data: config }, { data: members }] = await Promise.all([
        adminSupabase.from('loyalty_config').select('*').eq('restaurant_id', rid).single(),
        adminSupabase.from('loyalty_members').select('*').eq('restaurant_id', rid).order('lifetime_points', { ascending: false }).limit(100),
    ])

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Loyalty Program" description="Configure rewards, tiers and view all loyalty members." icon={<Heart size={18} />} color="orange" />
            <LoyaltyManager initialConfig={config} initialMembers={members || []} restaurantId={rid} />
        </div>
    )
}
