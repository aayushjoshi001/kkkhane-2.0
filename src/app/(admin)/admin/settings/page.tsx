import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import SettingsManager from '@/components/admin/SettingsManager'
import { getRestaurantFeatures } from '@/lib/features'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Settings } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
    const { restaurantId, role } = await getCurrentUser()

    const adminSupabase = await createAdminClient()

    // Fetch restaurant + feature flags + business hours + bank accounts in parallel
    const [{ data: restaurant }, features, { data: settingsRow }, { data: bankAccounts }] = await Promise.all([
        adminSupabase
            .from('restaurants')
            .select('*')
            .eq('id', restaurantId)
            .single(),
        getRestaurantFeatures(restaurantId),
        adminSupabase
            .from('settings')
            .select('business_hours')
            .eq('restaurant_id', restaurantId)
            .maybeSingle(),
        adminSupabase
            .from('bank_accounts')
            .select('id, name')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
    ])

    if (!restaurant) redirect('/unauthorized')

    // tax_rate / currency / currency_symbol live in settings.features_v2
    // (defaultTaxRate / currency / currencySymbol), NOT on the restaurants row.
    const initialRestaurant = {
        ...restaurant,
        tax_rate: features?.defaultTaxRate ?? 13,
        currency: features?.currency ?? 'NPR',
        currency_symbol: features?.currencySymbol ?? 'Rs.',
    }

    return (
        <div className="space-y-6 pb-24 max-w-5xl mx-auto w-full">
            <PremiumPageHeader 
                title="System Settings" 
                description="Configure your restaurant's core information and operational rules" 
                icon={<Settings size={18} />}
                color="purple"
            />

            <div className="-mt-12 relative z-20 w-full">
                <SettingsManager
                    initialRestaurant={initialRestaurant}
                    initialFeatures={features}
                    initialBusinessHours={settingsRow?.business_hours ?? null}
                    bankAccounts={bankAccounts ?? []}
                    canEdit={role === 'super_admin' || role === 'manager'}
                />
            </div>
        </div>
    )
}
