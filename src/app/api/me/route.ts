import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { ROLE_LANDING } from '@/lib/roleLanding'

// Reads the current session's cookies, so it must never be cached — a cached
// response would show one visitor's identity (or a stale "logged out") to the
// next. The marketing nav polls this to decide between the avatar menu and the
// Login/Start Free buttons.
export const dynamic = 'force-dynamic'

export async function GET() {
    const user = await getOptionalUser()
    if (!user) {
        return NextResponse.json({ authenticated: false })
    }

    // full_name + avatar_url aren't in the access-token claims, so read them
    // from the user's row. Best-effort: a miss just falls back to the email and
    // a generated initials avatar client-side.
    let fullName = ''
    let avatarUrl: string | null = null
    try {
        const admin = await createAdminClient()
        const { data } = await admin
            .from('users')
            .select('full_name, avatar_url')
            .eq('id', user.id)
            .maybeSingle()
        fullName = data?.full_name || ''
        avatarUrl = data?.avatar_url || null
    } catch {
        // ignore — degrade to email/initials
    }

    return NextResponse.json({
        authenticated: true,
        fullName,
        email: user.email,
        avatarUrl,
        dashboardHref: ROLE_LANDING[user.role] || '/admin/dashboard',
    })
}
