'use client'

import { createClient } from '@/lib/supabase/client'
import { captureError, clearSentryUser } from '@/lib/sentry'

interface RouterLike {
    push: (href: string) => void
    refresh: () => void
}

/**
 * Shared sign-out flow used by every authenticated layout's logout button
 * (AdminSidebar, KitchenLayoutClient, WaiterLayoutClient, SignOutButton) and by
 * the /unauthorized page — previously duplicated, with one variant skipping
 * router.refresh().
 *
 * The browser-side signOut() can fail before it ever reaches Supabase — the
 * user is offline, or an extension/CSP blocks the auth origin, which surfaces
 * as `TypeError: Failed to fetch`. Two things must hold when that happens:
 *
 *   1. The user still ends up on /login. Previously the throw escaped and
 *      router.push() never ran, so the logout button silently did nothing.
 *   2. The session is actually terminated. Redirecting alone is not enough:
 *      the proxy only bounces *unauthenticated* users off protected routes, so
 *      a live session cookie would leave the user "logged out" on screen while
 *      still authenticated. /auth/signout clears the cookies server-side, and
 *      being same-origin it matches `'self'` in connect-src — it cannot be
 *      blocked by the same CSP that broke the direct call.
 */
export async function signOutAndRedirect(router: RouterLike) {
    try {
        const { error } = await createClient().auth.signOut()
        if (error) throw error
    } catch (error) {
        captureError(error, { context: 'signOutAndRedirect: falling back to /auth/signout' })
        try {
            await fetch('/auth/signout', { method: 'POST', redirect: 'manual' })
        } catch (fallbackError) {
            // Nothing left to try — still redirect so the button is never a
            // dead end, and the proxy will re-challenge on the next request.
            captureError(fallbackError, { context: 'signOutAndRedirect: fallback failed' })
        }
    } finally {
        clearSentryUser()
        router.push('/login')
        router.refresh()
    }
}
