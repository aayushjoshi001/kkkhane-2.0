'use client'

import { createClient } from '@/lib/supabase/client'

interface RouterLike {
    push: (href: string) => void
    refresh: () => void
}

/**
 * Shared sign-out flow used by every authenticated layout's logout button —
 * previously duplicated (with one variant skipping router.refresh()) across
 * AdminSidebar, SuperAdminSidebar, KitchenLayoutClient, WaiterLayoutClient,
 * SignOutButton, and OnboardingGetStarted.
 */
export async function signOutAndRedirect(router: RouterLike) {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
}
