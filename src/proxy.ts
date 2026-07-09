import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from '@/lib/redis'
import { ROLE_LANDING } from '@/lib/roleLanding'

// Route protection rules — first match wins
const ROUTE_RULES: Array<{
    pattern: RegExp
    allowedRoles: string[] | null  // null = any authenticated user
}> = [
    { pattern: /^\/admin(\/|$)/, allowedRoles: ['super_admin', 'manager'] },
    { pattern: /^\/kitchen(\/|$)/, allowedRoles: ['kitchen', 'manager', 'super_admin'] },
    { pattern: /^\/bar(\/|$)/, allowedRoles: ['bartender', 'manager', 'super_admin'] },
    { pattern: /^\/waiter(\/|$)/, allowedRoles: ['waiter', 'manager', 'super_admin'] },
    { pattern: /^\/cashier(\/|$)/, allowedRoles: ['cashier', 'waiter', 'manager', 'super_admin'] },
]

// Rate limiter for public QR/table pages — lazy-initialised, Edge-compatible.
// Limits to 60 requests/min per IP to prevent DoS on public menu pages.
//
// Shares the Redis client from lib/redis.ts (retry:false + a real per-request
// AbortSignal, plus its circuit breaker) instead of a bare Redis.fromEnv(). The
// old version raced the call against an external 500ms setTimeout, which is
// exactly the anti-pattern documented at the top of lib/redis.ts: the external
// timeout always won before the client's own 5-retry/~4.5s backoff surfaced the
// real error, so every request paid the full 500ms whenever Upstash was slow —
// forever, with nothing ever tripping a breaker.
let _qrLimiter: Ratelimit | null | undefined

function getQrLimiter(): Ratelimit | null {
    if (_qrLimiter !== undefined) return _qrLimiter
    const redis = getRedis()
    if (!redis) {
        _qrLimiter = null
        return _qrLimiter
    }
    try {
        _qrLimiter = new Ratelimit({
            redis,
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

// True if this request carries a Supabase auth cookie. An anonymous customer
// scanning a QR code never has one, so there is no session to verify or refresh
// and updateSession() can be skipped entirely for them.
function hasAuthCookie(request: NextRequest): boolean {
    return request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl
    const isPublicQrPath = /^\/t\//.test(pathname) || /^\/takeout\//.test(pathname) || /^\/invite\//.test(pathname)

    // Rate-limit public QR/table pages to prevent DoS.
    // Wrapped in try/catch so a transient Redis failure never 500s a customer.
    // The deadline now lives inside the Redis client itself (see getRedis()),
    // so no external race is needed here.
    if (isPublicQrPath) {
        const limiter = getQrLimiter()
        if (limiter) {
            try {
                const ip = getRequestIp(request)
                const { success } = await limiter.limit(ip)
                if (!success) {
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

    // A fully public QR page hit by an anonymous customer (no Supabase auth
    // cookie at all) has no session to verify or refresh — skip updateSession()
    // entirely. Staff testing a customer page while logged in still carry the
    // cookie, so they still get the full session-refresh path below.
    if (isPublicQrPath && !hasAuthCookie(request)) {
        return NextResponse.next()
    }

    // Always refresh the Supabase session cookie — this is required by @supabase/ssr
    // to keep the access token valid across server components and API routes.
    // updateSession already verified the JWT locally and hands back its claims,
    // so the role check below reuses them rather than decoding the token again.
    const { user, claims, supabaseResponse } = await updateSession(request)

    // If it is a Next.js Server Action, ALWAYS let it pass through!
    // Next.js actions will run and check auth/permissions internally, returning standard
    // serializable responses instead of raw middleware redirects/401s which crash the client action fetcher.
    if (request.headers.has('next-action')) {
        return supabaseResponse
    }

    // Find whether this path needs protection
    const rule = ROUTE_RULES.find(r => r.pattern.test(pathname))

    // Public route — return the response with refreshed cookies and nothing else
    if (!rule) {
        return supabaseResponse
    }

    // ── Not authenticated ───────────────────────────────────────────────────────
    if (!user) {
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('redirect', pathname)
        const response = NextResponse.redirect(loginUrl)
        // Copy over any cookie mutations from updateSession
        supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) => {
            response.cookies.set(name, value, opts)
        })
        return response
    }

    // ── Role check ──────────────────────────────────────────────────────────────
    if (rule.allowedRoles) {

        // claims came from updateSession's getClaims(), which verified the JWT
        // signature against the cached JWKS — a tampered token was already
        // rejected there (claims would be null). app_role is injected by the
        // custom_access_token_hook (004_jwt_claims_hook.sql).
        //
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
