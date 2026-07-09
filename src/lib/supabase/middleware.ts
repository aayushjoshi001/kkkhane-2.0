// lib/supabase/middleware.ts
// Supabase client for Edge Middleware — used for RBAC, session validation, rate limiting
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make your application
    // very slow due to unnecessary session refreshing.
    const { data, error } = await supabase.auth.getUser()
    const user = error ? null : data.user

    if (error && isDeadRefreshToken(error)) {
        for (const cookie of request.cookies.getAll()) {
            if (cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')) {
                supabaseResponse.cookies.set(cookie.name, '', { maxAge: 0, path: '/' })
            }
        }
    }

    return { user, supabaseResponse, supabase }
}

/**
 * Is this error the auth server definitively rejecting our refresh token?
 *
 * Only then do we clear the auth cookies — otherwise Supabase retries the dead
 * token on every request, flooding the logs and blocking.
 *
 * Two classes of error must NOT clear them, because the session is still valid:
 *
 *   • `refresh_token_already_used` — the ordinary outcome of a rotation race.
 *     Parallel RSC requests, the browser's auto-refresh and
 *     SessionSync.refreshSession() can present the same refresh token at once;
 *     one rotates it and writes the new cookie, the losers see "already used".
 *     Wiping cookies here logged people out mid-session (the sudden-logout bug).
 *
 *   • Transient failures — a 5xx from the auth server, or a fetch that never got
 *     a response. Those say nothing about the session, so we leave the cookies
 *     alone and let the next request recover.
 *
 * Note the auth server does not report a dead token under a single stable code:
 * it has used `refresh_token_not_found` and now `validation_failed`
 * ("Refresh token is not valid"), both HTTP 400. So match the family, and gate on
 * a 4xx status so a 5xx can never be read as a rejection.
 */
function isDeadRefreshToken(error: { code?: string; status?: number; message: string }): boolean {
    if (error.code === 'refresh_token_already_used') return false

    const status = error.status ?? 0
    const isDefinitiveRejection = status >= 400 && status < 500
    if (!isDefinitiveRejection) return false

    return error.code === 'refresh_token_not_found' || /refresh token/i.test(error.message)
}
