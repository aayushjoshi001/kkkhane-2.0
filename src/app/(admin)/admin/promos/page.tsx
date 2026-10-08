import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PromoCodesManager from './PromoCodesManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Percent } from 'lucide-react'

import { redirect } from 'next/navigation'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

export default async function AdminPromosPage() {
    const { restaurantId } = await getCurrentUser()
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.promosEnabled) {
        redirect('/admin/dashboard')
    }
    const adminSupabase = await createAdminClient()

    const { data: promos } = await adminSupabase
        .from('promo_codes')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Promo Codes" description="Create and manage promotional discount codes for your customers." icon={<Percent size={18} />} color="orange" />
            <PromoCodesManager
                initialPromos={promos || []}
                restaurantId={restaurantId}
            />
        </div>
    )
}
