import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import PrintersManager from '@/components/admin/PrintersManager'
import { Printer as PrinterIcon } from 'lucide-react'
import type { Printer } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function PrintersPage() {
    const { restaurantId, role } = await getCurrentUser()
    if (role !== 'manager' && role !== 'super_admin' && role !== 'owner') redirect('/unauthorized')

    const supabase = await createAdminClient()
    const { data: printers } = await supabase
        .from('printers')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: true })

    return (
        <div className="space-y-6 pb-24 max-w-5xl mx-auto w-full">
            <PremiumPageHeader
                title="Printer Management"
                description="Configure network (LAN) printers so KOT and bills auto-print for this restaurant"
                icon={<PrinterIcon size={18} />}
                color="blue"
            />
            <PrintersManager initialPrinters={(printers as Printer[]) ?? []} />
        </div>
    )
}
