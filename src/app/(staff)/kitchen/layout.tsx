import { ReactNode } from 'react'
import KitchenLayoutClient from '@/components/kitchen/KitchenLayoutClient'
import SessionSync from '@/components/shared/SessionSync'
import { getCurrentUser } from '@/lib/auth'
import { getRestaurantFeatures } from '@/lib/features'
import { FeatureProvider } from '@/lib/contexts/FeatureContext'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyClientIp } from '@/lib/ip-check'
import { getActiveShift } from '@/app/api/staff/actions'
import { redirect } from 'next/navigation'

export default async function KitchenLayout({ children }: { children: ReactNode }) {
    const { id: userId, restaurantId, role } = await getCurrentUser()

    // Enforce WiFi IP check for staff
    const { allowed } = await verifyClientIp(restaurantId, role)
    if (!allowed) {
        redirect('/wifi-required?redirect=/kitchen')
    }

    const adminSupabase = await createAdminClient()

    // Run user/restaurant name lookups and features in parallel.
    // getRestaurantFeatures is cached (30s) — the page's own call hits the cache.
    const [{ data: user }, { data: restaurant }, features] = await Promise.all([
        adminSupabase.from('users').select('full_name').eq('id', userId).single(),
        adminSupabase.from('restaurants').select('name').eq('id', restaurantId).single(),
        getRestaurantFeatures(restaurantId),
    ])

    const notificationSoundUrl = (features as Record<string, unknown> | null)?.notificationSoundUrl as string | null | undefined

    const onShift = !!(await getActiveShift(userId))

    return (
        <FeatureProvider features={features}>
            <SessionSync userId={userId} />
            <KitchenLayoutClient
                restaurantName={restaurant?.name || undefined}
                staffName={user?.full_name || undefined}
                userId={userId}
                restaurantId={restaurantId}
                onShift={onShift}
                shiftsEnabled={(features as { staffShiftsEnabled?: boolean } | null)?.staffShiftsEnabled === true}
                notificationSoundUrl={notificationSoundUrl || null}
            >
                {children}
            </KitchenLayoutClient>
        </FeatureProvider>
    )
}
