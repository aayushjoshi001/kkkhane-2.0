import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import TableManager from '@/components/admin/TableManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { QrCode } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function TablesManagementPage() {
    const { restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    const [{ data: tables }, { data: restaurant }] = await Promise.all([
        adminSupabase
            .from('tables')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('label', { ascending: true }),
        adminSupabase
            .from('restaurants')
            .select('name')
            .eq('id', restaurantId)
            .single()
    ])

    // Also get the base URL for generating the full QR link
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    return (
        <div className="space-y-6">
            <PremiumPageHeader 
                title="Table Management" 
                description="Configure restaurant tables and generate QR ordering codes" 
                icon={<QrCode size={18} />}
                color="green"
            />

            <TableManager
                initialTables={tables || []}
                restaurantId={restaurantId}
                restaurantName={restaurant?.name || 'Restaurant'}
                appUrl={appUrl}
            />
        </div>
    )
}
