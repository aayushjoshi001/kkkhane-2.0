import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PaymentVerificationPanel from '@/components/admin/PaymentVerificationPanel'
import { getRestaurantFeatures } from '@/lib/features'
import { redirect } from 'next/navigation'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { CreditCard } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage() {
    const { id: userId, restaurantId, role } = await getCurrentUser()
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.irdSyncEnabled || role === 'manager') {
        redirect('/admin/dashboard')
    }

    const supabase = await createAdminClient()

    const { data: claims } = await supabase
        .from('payment_verifications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(100)

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Payment Verification" description="Review and approve customer payment claims." icon={<CreditCard size={18} />} color="orange" />

            <PaymentVerificationPanel
                initialClaims={claims || []}
                restaurantId={restaurantId}
                userId={userId}
            />
        </div>
    )
}
