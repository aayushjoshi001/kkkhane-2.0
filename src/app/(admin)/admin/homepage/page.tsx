import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import HomepageManager from '@/components/admin/HomepageManager'

export const dynamic = 'force-dynamic'

export default async function HomepagePage() {
    const { restaurantId, role } = await getCurrentUser()

    if (role !== 'manager' && role !== 'super_admin') {
        redirect('/unauthorized')
    }

    const adminSupabase = await createAdminClient()

    // Fetch the restaurant to verify it exists
    const { data: restaurant, error } = await adminSupabase
        .from('restaurants')
        .select('id, name')
        .eq('id', restaurantId)
        .single()

    if (!restaurant || error) {
        redirect('/unauthorized')
    }

    return (
        <div className="space-y-6">
            <header>
                <div className="flex justify-between items-center bg-surface p-6 rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                    <div>
                        <h1 className="text-h1 font-extrabold text-ink tracking-tight">Homepage Manager</h1>
                        <p className="text-sm font-medium text-ink-subtle mt-1 max-w-2xl">Customize your restaurant&apos;s homepage that customers see when they scan the QR code</p>
                    </div>
                </div>
            </header>

            <div>
                <HomepageManager restaurantId={restaurantId} />
            </div>
        </div>
    )
}
