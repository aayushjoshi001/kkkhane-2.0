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

import AdSpace from '@/components/shared/AdSpace'

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
    if (!isSuperAdmin && currentUser.restaurantId) {
        const [{ data }, restaurantFeatures, restaurantMode] = await Promise.all([
            adminSupabase
                .from('restaurants')
                .select('name')
                .eq('id', currentUser.restaurantId)
                .single(),
            getRestaurantFeatures(currentUser.restaurantId),
            getRestaurantMode(currentUser.restaurantId),
        ])
        restaurantName = data?.name || undefined
        features = restaurantFeatures
        mode = restaurantMode
    }

    return (
        <FeatureProvider features={features}>
        <BusinessModeProvider mode={mode}>
            <SidebarProvider>
                <div className="h-screen bg-canvas flex overflow-hidden">
                    <SessionSync userId={currentUser.id} />
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
                                <AdSpace />
                                {children}
                            </div>
                        </div>
                    </main>
                </div>
            </SidebarProvider>
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
