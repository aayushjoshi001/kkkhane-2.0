import { ReactNode } from 'react'
import WaiterLayoutClient from '@/components/waiter/WaiterLayoutClient'
import SessionSync from '@/components/shared/SessionSync'
import { getCurrentUser } from '@/lib/auth'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { FeatureProvider, BusinessModeProvider } from '@/lib/contexts/FeatureContext'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyClientIp } from '@/lib/ip-check'
import { getActiveShift } from '@/app/api/staff/actions'
import { redirect } from 'next/navigation'

export default async function WaiterLayout({ children }: { children: ReactNode }) {
    const { id: userId, restaurantId, role } = await getCurrentUser()

    // Enforce WiFi IP check for staff
    const { allowed } = await verifyClientIp(restaurantId, role)
    if (!allowed) {
        redirect('/wifi-required?redirect=/waiter')
    }

    const adminSupabase = await createAdminClient()

    // Run user/restaurant name lookups and features in parallel.
    // getRestaurantFeatures is cached (30s) — the page's own call hits the cache.
    const [{ data: user }, { data: restaurant }, features, activeShift, mode] = await Promise.all([
        adminSupabase.from('users').select('full_name').eq('id', userId).single(),
        adminSupabase.from('restaurants').select('name').eq('id', restaurantId).single(),
        getRestaurantFeatures(restaurantId),
        getActiveShift(userId),
        getRestaurantMode(restaurantId),
    ])

    const notificationSoundUrl = (features as Record<string, unknown> | null)?.notificationSoundUrl as string | null | undefined
    const onShift = !!activeShift

    return (
        <FeatureProvider features={features}>
        <BusinessModeProvider mode={mode}>
            <SessionSync userId={userId} />
            <WaiterLayoutClient
                restaurantName={restaurant?.name || undefined}
                staffName={user?.full_name || undefined}
                userId={userId}
                restaurantId={restaurantId}
                onShift={onShift}
                shiftsEnabled={(features as { staffShiftsEnabled?: boolean } | null)?.staffShiftsEnabled === true}
                notificationSoundUrl={notificationSoundUrl || null}
            >
                {children}
            </WaiterLayoutClient>
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
