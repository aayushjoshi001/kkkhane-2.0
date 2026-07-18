import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PaymentVerificationPanel from '@/components/admin/PaymentVerificationPanel'
import { getRestaurantFeatures } from '@/lib/features'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.irdSyncEnabled) {
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
            <header className="mb-6">
                <h1 className="text-h2 font-extrabold text-ink">Payment Verification</h1>
                <p className="text-ink-subtle font-medium mt-1">Review and approve customer payment claims</p>
            </header>

            <PaymentVerificationPanel
                initialClaims={claims || []}
                restaurantId={restaurantId}
                userId={userId}
            />
        </div>
    )
}
