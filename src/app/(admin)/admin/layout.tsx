import RealtimeCatchUp from '@/components/shared/RealtimeCatchUp'
import { ReactNode } from 'react'
import AdminSidebar from '@/components/admin/AdminSidebar'
import SuperAdminSidebar from '@/components/admin/SuperAdminSidebar'
import AdminOrderNotifier from '@/components/admin/AdminOrderNotifier'
import SoundEnableButton from '@/components/shared/SoundEnableButton'
import SessionSync from '@/components/shared/SessionSync'
import { CommandHint } from '@/components/ui/CommandHint'
import CommandPaletteMount from '@/components/ui/CommandPaletteMount'
import { requireRoleWithOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { FeatureProvider, BusinessModeProvider } from '@/lib/contexts/FeatureContext'
import type { BusinessMode } from '@/lib/businessMode'
import { SidebarProvider } from '@/lib/contexts/SidebarContext'
import SidebarToggle from '@/components/admin/SidebarToggle'
import CalendarToggle from '@/components/shared/CalendarToggle'
import BusinessSessionControl from '@/components/shared/BusinessSessionControl'
import { getNstDateString } from '@/lib/timezone'

import { BusinessSessionProvider } from '@/lib/contexts/BusinessSessionContext'
import BusinessGuard from '@/components/shared/BusinessGuard'
import BusinessDayReminder from '@/components/shared/BusinessDayReminder'
import TrialBanner from '@/components/admin/TrialBanner'
import { trialState, type TrialState } from '@/lib/trial'

export default async function AdminLayout({ children }: { children: ReactNode }) {
    // requireRole() uses the React.cache-wrapped getCurrentUser — no duplicate DB call
    // when the page also calls getCurrentUser().
    const currentUser = await requireRoleWithOptions(['super_admin', 'manager'], { allowSuspended: true })
    const roleNameRaw = currentUser.role || 'unknown'

    const roleDisplay = roleNameRaw
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')

    const isSuperAdmin = roleNameRaw === 'super_admin'

    const adminSupabase = await createAdminClient()
    const { data: dbUser } = await adminSupabase.from('users').select('avatar_url').eq('id', currentUser.id).single()
    const userAvatar = dbUser?.avatar_url || undefined

    // Fetch restaurant name + currency features for the manager sidebar/app —
    // only needed for manager role (super_admin operates across tenants).
    let restaurantName: string | undefined
    let features: Awaited<ReturnType<typeof getRestaurantFeatures>> = null
    let mode: BusinessMode = 'dine_in'
    let openSession: any = null
    let trial: TrialState = { kind: 'none' }
    let trialEndsLabel = ''
    const todayDate = getNstDateString()

    if (!isSuperAdmin && currentUser.restaurantId) {
        const [{ data: restaurantRow, error: restaurantError }, restaurantFeatures, restaurantMode, { data: sessionData }] = await Promise.all([
            adminSupabase
                .from('restaurants')
                // The subscription columns ride along on a query that was
                // already being made, so the trial banner costs no extra
                // round-trip on every admin page.
                .select('name, subscription_tier, subscription_status, subscription_expires_at, trial_ends_at')
                .eq('id', currentUser.restaurantId)
                .maybeSingle(),
            getRestaurantFeatures(currentUser.restaurantId),
            getRestaurantMode(currentUser.restaurantId),
            adminSupabase
                .from('day_book_sessions')
                .select('id, date, status, opening_balance, opening_bank_balance')
                .eq('restaurant_id', currentUser.restaurantId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ])
        // A database that has not had 20260805090000 applied yet has no
        // trial_ends_at column, and PostgREST fails the WHOLE select over one
        // unknown column — which would take the restaurant name down with it
        // and leave the admin panel looking broken. Falling back to the name
        // alone means a deploy that lands ahead of its migration degrades to
        // "no trial banner" rather than to an unusable panel.
        let data = restaurantRow
        if (!data && restaurantError) {
            const { data: nameOnly } = await adminSupabase
                .from('restaurants')
                .select('name')
                .eq('id', currentUser.restaurantId)
                .maybeSingle()
            data = nameOnly as typeof restaurantRow
        }

        restaurantName = data?.name || undefined
        features = restaurantFeatures
        mode = restaurantMode
        openSession = sessionData
        trial = trialState({
            tier: data?.subscription_tier,
            status: data?.subscription_status,
            expiresAt: data?.subscription_expires_at,
            trialEndsAt: data?.trial_ends_at,
        })
        // Formatted here rather than in the banner: the client would format it
        // in the visitor's own locale and timezone, which differs from the
        // server's and breaks hydration. Nepal time is the business's time.
        const endsAtIso = trial.kind === 'active' ? trial.endsAt : trial.kind === 'ended' ? trial.endedAt : null
        trialEndsLabel = endsAtIso
            ? new Date(endsAtIso).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu',
            })
            : ''
    }

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
            userRole={roleNameRaw}
            todayDate={todayDate}
            restaurantId={currentUser.restaurantId || undefined}
        >
            <SidebarProvider>
                <div className="h-screen bg-canvas flex overflow-hidden">
                    <SessionSync userId={currentUser.id} />
                    {/* Nags about a day left open for an earlier date, and about a day
                        not opened yet where the lock screen isn't already saying so.
                        Super admins have no till of their own to open or close. */}
                    {!isSuperAdmin && <BusinessDayReminder />}
                    {isSuperAdmin ? <SuperAdminSidebar userRole={roleNameRaw} userAvatar={userAvatar} /> : <AdminSidebar userRole={roleNameRaw} restaurantName={restaurantName} userAvatar={userAvatar} />}
                    {!isSuperAdmin && currentUser.restaurantId && (
                        <>
                            <AdminOrderNotifier restaurantId={currentUser.restaurantId} />
                            <RealtimeCatchUp restaurantId={currentUser.restaurantId} />
                        </>
                    )}

                    {/* Main Content */}
                    <main className="flex-1 flex flex-col overflow-hidden min-w-0">
                        <header className="print:hidden bg-surface border-b border-hairline px-5 md:px-8 h-16 flex items-center justify-between shrink-0 z-10">
                            <SidebarToggle isSuperAdmin={isSuperAdmin} />
                            <div className="flex items-center gap-3">
                                {!isSuperAdmin && (
                                    <BusinessSessionControl variant="compact" />
                                )}
                                <CalendarToggle />
                                <CommandHint />
                                {!isSuperAdmin && <SoundEnableButton variant="light" />}
                                <span className={`text-caption font-semibold px-2.5 py-1 rounded-full ${
                                    isSuperAdmin
                                        ? 'bg-brand-50 text-brand-700'
                                        : 'bg-[var(--neutral-badge-bg)] text-[var(--neutral-badge-fg)]'
                                }`}>
                                    {roleDisplay}
                                </span>
                            </div>
                        </header>
                        <CommandPaletteMount role={roleNameRaw} theme="light" />
                        <div className="flex-1 overflow-auto p-5 md:p-8">
                            <div className="max-w-6xl mx-auto">
                                {/* Above BusinessGuard on purpose: a manager who
                                    has not opened the day yet still needs to be
                                    told their trial is running out. */}
                                {!isSuperAdmin && (
                                    <TrialBanner state={trial} endsAtLabel={trialEndsLabel} />
                                )}
                                {isSuperAdmin ? (
                                    children
                                ) : (
                                    <BusinessGuard>
                                        {children}
                                    </BusinessGuard>
                                )}
                            </div>
                        </div>
                    </main>
                </div>
            </SidebarProvider>
        </BusinessSessionProvider>
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
