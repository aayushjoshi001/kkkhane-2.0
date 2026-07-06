import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PromoCodesManager from './PromoCodesManager'

export const revalidate = 0

export default async function AdminPromosPage() {
    const { restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const { data: promos } = await adminSupabase
        .from('promo_codes')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })

    return (
        <div className="space-y-6">
            <div className="bg-surface p-6 rounded-xl border border-hairline-strong shadow-sm">
                <h1 className="text-2xl font-bold text-ink">Promo Codes</h1>
                <p className="text-ink-subtle mt-1">Create and manage promotional codes for your customers.</p>
            </div>
            <PromoCodesManager
                initialPromos={promos || []}
                restaurantId={restaurantId}
            />
        </div>
    )
}
