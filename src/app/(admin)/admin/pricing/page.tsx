import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PricingRulesManager from './PricingRulesManager'

import { redirect } from 'next/navigation'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

export default async function AdminPricingPage() {
    const { restaurantId: rid } = await getCurrentUser()
    const features = await getRestaurantFeatures(rid)
    if (!features?.dynamicPricingEnabled) {
        redirect('/admin/dashboard')
    }
    const adminSupabase = await createAdminClient()

    const [{ data: rules }, { data: items }, { data: categories }] = await Promise.all([
        adminSupabase.from('pricing_rules').select('*, menu_items(name)').eq('restaurant_id', rid).order('priority', { ascending: false }).order('created_at', { ascending: false }),
        adminSupabase.from('menu_items').select('id, name').eq('restaurant_id', rid).eq('is_available', true).order('name'),
        adminSupabase.from('menu_categories').select('id, name').eq('restaurant_id', rid).order('sort_order'),
    ])

    return (
        <div className="space-y-6">
            <div className="bg-surface p-6 rounded-xl border border-hairline-strong shadow-sm">
                <h1 className="text-2xl font-bold text-ink">Dynamic Pricing</h1>
                <p className="text-ink-subtle mt-1">Schedule time-, day- and date-based price changes for items, categories or the whole menu.</p>
            </div>
            <PricingRulesManager
                initialRules={rules || []}
                menuItems={items || []}
                categories={categories || []}
                restaurantId={rid}
            />
        </div>
    )
}
