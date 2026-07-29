import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import LoyaltyManager from './LoyaltyManager'

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
            <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-h2 font-extrabold text-ink">Loyalty Program</h1>
                    <p className="text-ink-subtle font-medium mt-1">Configure rewards, tiers and view members</p>
                </div>
            </header>
            <LoyaltyManager initialConfig={config} initialMembers={members || []} restaurantId={rid} />
        </div>
    )
}
