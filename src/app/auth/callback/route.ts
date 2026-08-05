import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getOptionalUser } from '@/lib/auth'
import { ROLE_LANDING } from '@/lib/roleLanding'

// Handles the redirect back from an OAuth provider (Google, etc). Supabase
// sends the browser here with a `code` param; exchanging it here (server-side,
// via a cookie-aware client) is what lets the session cookie get set as
// httpOnly — the same reason /reset-password does its exchange differently
// (client-side) only because that flow needs the session to update a password
// without ever really "logging in".
//
// NOTE: for this route to be reached at all, its URL must be on the Supabase
// project's Redirect URLs allow-list. A redirect matching none of them is
// silently downgraded to the project's Site URL, which drops the user on the
// marketing home page with a `?code=` nobody consumes and no session — see the
// same warning in supabase/config.toml, and the salvage handler on `/`.

/**
 * A `next` we are willing to send a browser to.
 *
 * `next` arrives in the query string, so it is attacker-supplied: a link built
 * with `?next=https://evil.example` would otherwise turn our own callback into
 * an open redirect that launders phishing through a domain the user trusts.
 * Only same-origin absolute paths pass — and `//host` is rejected explicitly
 * because browsers read it as protocol-relative, i.e. another origin.
 */
function safeNext(next: string | null): string | null {
    if (!next) return null
    if (!next.startsWith('/')) return null
    if (next.startsWith('//')) return null
    return next
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = safeNext(searchParams.get('next'))

    if (!code) {
        return NextResponse.redirect(`${origin}/login?error=oauth`)
    }

    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
        return NextResponse.redirect(`${origin}/login?error=oauth`)
    }

    const currentUser = await getOptionalUser()
    if (!currentUser) {
        // Exchanged a code but resolved no user — the session cookie did not
        // survive. Sending them on would land them on a protected page that
        // bounces straight back here.
        return NextResponse.redirect(`${origin}/login?error=oauth`)
    }

    // Where they end up is decided by what they actually have, not by what the
    // link asked for. `next` is a preference; the two cases below are facts,
    // and honouring a stale `next` over them is what sent people to the wrong
    // place:
    //
    //   - Signing in with Google from /login carries no `next` at all, so a
    //     brand-new user fell through to a role landing page they cannot use.
    //   - The /signup button hardcodes `next=/onboarding`, so someone who
    //     already runs a venue and simply clicked the wrong button was sent to
    //     "create your restaurant" instead of to their dashboard.
    //
    // `getOptionalUser` reports the role 'onboarding' for a signed-in user with
    // no restaurant_id — that is the whole test for "brand new".
    if (currentUser.role === 'onboarding') {
        return NextResponse.redirect(`${origin}/onboarding`)
    }

    // They have a business. Honour `next` unless it points back into
    // onboarding, which they have already finished.
    const landing = next && !next.startsWith('/onboarding')
        ? next
        : (ROLE_LANDING[currentUser.role] || '/admin/dashboard')

    return NextResponse.redirect(`${origin}${landing}`)
}
