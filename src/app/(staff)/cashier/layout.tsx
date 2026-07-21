import { ReactNode } from 'react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyClientIp } from '@/lib/ip-check'
import { redirect } from 'next/navigation'
import WaiterLayoutClient from '@/components/waiter/WaiterLayoutClient'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { FeatureProvider, BusinessModeProvider } from '@/lib/contexts/FeatureContext'
import SessionSync from '@/components/shared/SessionSync'

export default async function CashierLayout({ children }: { children: ReactNode }) {
    const { id: userId, restaurantId, role } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')

    // Enforce WiFi IP check for staff
    const { allowed } = await verifyClientIp(restaurantId, role)
    if (!allowed) {
        redirect('/wifi-required?redirect=/cashier')
    }
    const adminSupabase = await createAdminClient()

    const [{ data: user }, { data: restaurant }, features, mode] = await Promise.all([
        adminSupabase.from('users').select('full_name').eq('id', userId).single(),
        adminSupabase.from('restaurants').select('name, address, contact_phone').eq('id', restaurantId).single(),
        getRestaurantFeatures(restaurantId),
        getRestaurantMode(restaurantId),
    ])

    const notificationSoundUrl = (features as Record<string, unknown> | null)?.notificationSoundUrl as string | null | undefined

    return (
        <FeatureProvider features={features}>
        <BusinessModeProvider mode={mode}>
            <SessionSync userId={userId} />
            <WaiterLayoutClient
                restaurantName={restaurant?.name || undefined}
                staffName={user?.full_name || undefined}
                notificationSoundUrl={notificationSoundUrl || null}
                portalLabel="Cashier"
                commandRole="cashier"
            >
                {children}
            </WaiterLayoutClient>
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
