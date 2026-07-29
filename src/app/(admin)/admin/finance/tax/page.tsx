import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import TaxManager from './TaxManager'

export const revalidate = 0

export default async function FinanceTaxPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [{ data: configurations }, { data: filings }, { data: restaurant }, { data: syncLogs }] = await Promise.all([
        supabase.from('tax_configurations').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('tax_filings').select('*, tax_configurations(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(200),
        supabase.from('restaurants').select('pan_number, vat_registered, vat_number').eq('id', restaurantId).single(),
        supabase.from('ird_sync_logs').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(100)
    ])

    return (
        <TaxManager
            initialConfigurations={configurations || []}
            initialFilings={filings || []}
            initialSyncLogs={syncLogs || []}
            restaurantTax={restaurant || { pan_number: null, vat_registered: false, vat_number: null }}
        />
    )
}
