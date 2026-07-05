import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { ROLE_LANDING } from '@/lib/roleLanding'

// Route protection rules — first match wins
const ROUTE_RULES: Array<{
    pattern: RegExp
    allowedRoles: string[] | null  // null = any authenticated user
}> = [
    { pattern: /^\/admin(\/|$)/, allowedRoles: ['super_admin', 'manager'] },
    { pattern: /^\/kitchen(\/|$)/, allowedRoles: ['kitchen', 'manager', 'super_admin'] },
    { pattern: /^\/waiter(\/|$)/, allowedRoles: ['waiter', 'manager', 'super_admin'] },
    { pattern: /^\/cashier(\/|$)/, allowedRoles: ['cashier', 'waiter', 'manager', 'super_admin'] },
]

// Rate limiter for public QR/table pages — lazy-initialised, Edge-compatible.
// Limits to 60 requests/min per IP to prevent DoS on public menu pages.
let _qrLimiter: Ratelimit | null | undefined

function getQrLimiter(): Ratelimit | null {
    if (_qrLimiter !== undefined) return _qrLimiter
    try {
        _qrLimiter = new Ratelimit({
            redis: Redis.fromEnv(),
            limiter: Ratelimit.slidingWindow(60, '60 s'),
            prefix: 'srms:rl:QR',
            analytics: false,
        })
    } catch {
        _qrLimiter = null
    }
    return _qrLimiter
}

function getRequestIp(request: NextRequest): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        request.headers.get('cf-connecting-ip') ||
        '127.0.0.1'
    )
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl
    console.log(`[PROXY_LOG] Path: ${pathname}`);

    // Rate-limit public QR/table pages to prevent DoS.
    // Wrapped in try/catch so a transient Redis failure never 500s a customer.
    if (/^\/t\//.test(pathname) || /^\/takeout\//.test(pathname) || /^\/invite\//.test(pathname)) {
        const limiter = getQrLimiter()
        if (limiter) {
            try {
                const ip = getRequestIp(request)
                const { success } = await limiter.limit(ip)
                if (!success) {
                    console.log(`[PROXY_LOG] Rate limited: ${pathname}`);
                    return new NextResponse('Too many requests. Please slow down.', {
                        status: 429,
                        headers: { 'Content-Type': 'text/plain', 'Retry-After': '60' },
                    })
                }
            } catch {
                // Redis unreachable — allow the request through rather than hard-failing
            }
        }
    }

    // Always refresh the Supabase session cookie — this is required by @supabase/ssr
    // to keep the access token valid across server components and API routes.
    const { user, supabaseResponse, supabase } = await updateSession(request)
    console.log(`[PROXY_LOG] Auth user: ${user ? user.email : 'null'}`);

    // Find whether this path needs protection
    const rule = ROUTE_RULES.find(r => r.pattern.test(pathname))
    console.log(`[PROXY_LOG] Rule matched: ${rule ? JSON.stringify(rule.allowedRoles) : 'none'}`);

    // Public route — return the response with refreshed cookies and nothing else
    if (!rule) {
        console.log(`[PROXY_LOG] Public route, passing through: ${pathname}`);
        return supabaseResponse
    }

    // ── Not authenticated ───────────────────────────────────────────────────────
    if (!user) {
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('redirect', pathname)
        console.log(`[PROXY_LOG] Not authenticated, redirecting to: ${loginUrl.toString()}`);
        const response = NextResponse.redirect(loginUrl)
        // Copy over any cookie mutations from updateSession
        supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) => {
            response.cookies.set(name, value, opts)
        })
        return response
    }

    // ── Role check ──────────────────────────────────────────────────────────────
    if (rule.allowedRoles) {
        // getClaims() verifies the JWT signature and returns its decoded claims —
        // including the app_role injected by the custom_access_token_hook
        // (004_jwt_claims_hook.sql). Unlike decoding the raw cookie, a tampered
        // token is rejected here instead of being trusted.
        const { data: claimsData } = await supabase.auth.getClaims()

        const claims = claimsData?.claims as { app_role?: unknown } | undefined
        // "unauthenticated" is the literal sentinel custom_access_token_hook embeds
        // for a signed-in user with no restaurant yet (e.g. mid-onboarding). It's a
        // truthy string, so treat it the same as "no role" rather than as a real
        // role — otherwise it gets redirected to ROLE_LANDING['unauthenticated'] ??
        // '/', which the '/' page then correctly bounces back to the protected
        // route via its own DB-backed check, causing an infinite redirect loop.
        const rawRole = typeof claims?.app_role === 'string' ? claims.app_role : null
        const role = rawRole && rawRole !== 'unauthenticated' ? rawRole : null

        // If we have a role and it's not allowed for this route, redirect the user
        // to their correct landing page instead of showing an error.
        // If role is null (JWT claims not yet populated, or the unauthenticated
        // sentinel), let it through — the page-level requireRole() will handle
        // the final gate using its DB fallback.
        if (role && !rule.allowedRoles.includes(role) && ROLE_LANDING[role]) {
            const landing = ROLE_LANDING[role]
            const redirectResponse = NextResponse.redirect(new URL(landing, request.url))
            supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) => {
                redirectResponse.cookies.set(name, value, opts)
            })
            return redirectResponse
        }
    }

    console.log(`[PROXY_LOG] Letting request pass through: ${pathname}`);
    return supabaseResponse
}

export const config = {
    matcher: [
        /*
         * Run on all paths except:
         *   - _next/static  — compiled JS/CSS bundles
         *   - _next/image   — image optimisation
         *   - Static assets — fonts, icons, images
         *
         * The public QR pages (/t/*) and marketing pages are intentionally
         * NOT in ROUTE_RULES so they pass through after the session refresh.
         */
        '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)$).*)',
    ],
}
