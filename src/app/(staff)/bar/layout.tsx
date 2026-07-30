import { ReactNode } from 'react'
import KitchenLayoutClient from '@/components/kitchen/KitchenLayoutClient'
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
import BusinessDayReminder from '@/components/shared/BusinessDayReminder'
import { getNstDateString } from '@/lib/timezone'

// The bar board reuses the kitchen shell and queue, parametrised by station.
// Kitchen and bar are the same job shape — a display that streams incoming
// order lines and advances them through prep — differing only in which lines
// they see and where their tickets print.
export default async function BarLayout({ children }: { children: ReactNode }) {
    const { id: userId, restaurantId, role } = await getCurrentUser()

    // Enforce WiFi IP check for staff
    const { allowed } = await verifyClientIp(restaurantId, role)
    if (!allowed) {
        redirect('/wifi-required?redirect=/bar')
    }

    const adminSupabase = await createAdminClient()
    const todayDate = getNstDateString()

    const [{ data: user }, { data: restaurant }, features, mode, activeShift, { data: openSession }] = await Promise.all([
        adminSupabase.from('users').select('full_name').eq('id', userId).single(),
        adminSupabase.from('restaurants').select('name').eq('id', restaurantId).single(),
        getRestaurantFeatures(restaurantId),
        getRestaurantMode(restaurantId),
        getActiveShift(userId),
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
            userRole={role || 'bar'}
            todayDate={todayDate}
            restaurantId={restaurantId}
        >
            <SessionSync userId={userId} />
            {/* Nags about a day left open for an earlier date, and about a day
                not opened yet where the lock screen isn't already saying so. */}
            <BusinessDayReminder />
            <KitchenLayoutClient
                station="bar"
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
            </KitchenLayoutClient>
        </BusinessSessionProvider>
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
