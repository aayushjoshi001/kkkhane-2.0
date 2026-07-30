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

import { BusinessSessionProvider } from '@/lib/contexts/BusinessSessionContext'
import BusinessGuard from '@/components/shared/BusinessGuard'
import { getNstDateString } from '@/lib/timezone'

export default async function WaiterLayout({ children }: { children: ReactNode }) {
    const { id: userId, restaurantId, role } = await getCurrentUser()

    // Enforce WiFi IP check for staff
    const { allowed } = await verifyClientIp(restaurantId, role)
    if (!allowed) {
        redirect('/wifi-required?redirect=/waiter')
    }

    const adminSupabase = await createAdminClient()
    const todayDate = getNstDateString()

    // Run user/restaurant name lookups and features in parallel.
    // getRestaurantFeatures is cached (30s) — the page's own call hits the cache.
    const [{ data: user }, { data: restaurant }, features, activeShift, mode, { data: openSession }] = await Promise.all([
        adminSupabase.from('users').select('full_name').eq('id', userId).single(),
        adminSupabase.from('restaurants').select('name').eq('id', restaurantId).single(),
        getRestaurantFeatures(restaurantId),
        getActiveShift(userId),
        getRestaurantMode(restaurantId),
        adminSupabase
            .from('day_book_sessions')
            .select('id, date, status, opening_balance, opening_bank_balance')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ])

    const notificationSoundUrl = (features as Record<string, unknown> | null)?.notificationSoundUrl as string | null | undefined
    const onShift = !!activeShift

    const sessionProp = openSession ? {
        id: openSession.id,
        date: openSession.date,
        status: openSession.status as 'open' | 'closed',
        opening_balance: Number(openSession.opening_balance),
        opening_bank_balance: Number(openSession.opening_bank_balance)
    } : null

    return (
        <FeatureProvider features={features}>
        <BusinessModeProvider mode={mode}>
        <BusinessSessionProvider
            initialSession={sessionProp}
            userRole={role || 'waiter'}
            todayDate={todayDate}
            restaurantId={restaurantId}
        >
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
                <BusinessGuard>
                    {children}
                </BusinessGuard>
            </WaiterLayoutClient>
        </BusinessSessionProvider>
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
