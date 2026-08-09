'use client'

import { createClient } from '@/lib/supabase/client'
import { captureError, clearSentryUser } from '@/lib/sentry'

interface RouterLike {
    push: (href: string) => void
    refresh: () => void
}

/**
 * Shared sign-out flow used by every authenticated layout's logout button.
 * Triggers server-side auto clock-out before clearing session cookies and redirecting to /login.
 */
export async function signOutAndRedirect(router: RouterLike) {
    try {
        // Trigger server-side auto clock-out and session clearance
        await fetch('/auth/signout', { method: 'POST', redirect: 'manual' })
        const { error } = await createClient().auth.signOut()
        if (error) throw error
    } catch (error) {
        captureError(error, { context: 'signOutAndRedirect: signout notice' })
    } finally {
        clearSentryUser()
        router.push('/login')
        router.refresh()
    }
}
