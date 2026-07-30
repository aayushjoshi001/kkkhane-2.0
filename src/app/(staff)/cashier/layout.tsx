import { ReactNode } from 'react'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyClientIp } from '@/lib/ip-check'
import { redirect } from 'next/navigation'
import WaiterLayoutClient from '@/components/waiter/WaiterLayoutClient'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { FeatureProvider, BusinessModeProvider } from '@/lib/contexts/FeatureContext'
import SessionSync from '@/components/shared/SessionSync'

import { BusinessSessionProvider } from '@/lib/contexts/BusinessSessionContext'
import BusinessGuard from '@/components/shared/BusinessGuard'
import BusinessDayReminder from '@/components/shared/BusinessDayReminder'
import { getNstDateString } from '@/lib/timezone'

export default async function CashierLayout({ children }: { children: ReactNode }) {
    const { id: userId, restaurantId, role } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')

    // Enforce WiFi IP check for staff
    const { allowed } = await verifyClientIp(restaurantId, role)
    if (!allowed) {
        redirect('/wifi-required?redirect=/cashier')
    }
    const adminSupabase = await createAdminClient()
    const todayDate = getNstDateString()

    const [{ data: user }, { data: restaurant }, features, mode, { data: openSession }] = await Promise.all([
        adminSupabase.from('users').select('full_name').eq('id', userId).single(),
        adminSupabase.from('restaurants').select('name, address, contact_phone').eq('id', restaurantId).single(),
        getRestaurantFeatures(restaurantId),
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
            userRole={role || 'cashier'}
            todayDate={todayDate}
            restaurantId={restaurantId}
        >
            <SessionSync userId={userId} />
            {/* Nags about a day left open for an earlier date, and about a day
                not opened yet where the lock screen isn't already saying so. */}
            <BusinessDayReminder />
            <WaiterLayoutClient
                restaurantName={restaurant?.name || undefined}
                staffName={user?.full_name || undefined}
                notificationSoundUrl={notificationSoundUrl || null}
                portalLabel="Cashier"
                commandRole="cashier"
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
