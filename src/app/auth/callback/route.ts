import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getOptionalUser } from '@/lib/auth'
import { ensureAutoClockIn } from '@/lib/autoClockIn'
import { ROLE_LANDING } from '@/lib/roleLanding'

// Handles the redirect back from an OAuth provider (Google, etc). Supabase
// sends the browser here with a `code` param; exchanging it here (server-side,
// via a cookie-aware client) is what lets the session cookie get set as
// httpOnly — the same reason /reset-password does its exchange differently
// (client-side) only because that flow needs the session to update a password
// without ever really "logging in".
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = searchParams.get('next')

    if (code) {
        const supabase = await createServerClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            if (next) return NextResponse.redirect(`${origin}${next}`)

            // Same landing-page resolution as a normal login — including the
            // transparent /onboarding redirect for a brand-new Google user
            // who doesn't have a restaurant yet.
            const currentUser = await getOptionalUser()
            if (currentUser?.id && currentUser?.restaurantId) {
                await ensureAutoClockIn(currentUser.id, currentUser.restaurantId)
            }
            const landing = currentUser ? (ROLE_LANDING[currentUser.role] || '/admin/dashboard') : '/login'
            return NextResponse.redirect(`${origin}${landing}`)
        }
    }

    return NextResponse.redirect(`${origin}/login?error=oauth`)
}
