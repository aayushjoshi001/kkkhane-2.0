import { Redis } from '@upstash/redis'
import { revalidateTag } from 'next/cache'

/**
 * Upstash is a *hot-read cache*, never a source of truth — every path through
 * this module must fail open to the fetcher. Two things previously stopped that
 * from being true when Upstash went away entirely (the DB was deleted, so its
 * hostname stopped resolving):
 *
 *   1. The client retries 5× with exponential backoff by default, so a DNS
 *      failure surfaced after ~4.5s. The old 500ms `Promise.race` timeout
 *      always won that race, so the caller only ever saw `Error('Redis
 *      timeout')` — never the underlying `fetch failed`. The circuit breaker
 *      keyed off the string 'fetch failed', so it could never trip, and every
 *      request paid 500ms per cache key, forever.
 *   2. The losing `redis.get()` promise kept retrying in the background for
 *      another ~4s, holding the function instance open after the race resolved.
 *
 * Both are fixed by pushing the deadline down into the request itself
 * (`retry: false` + a per-request AbortSignal) rather than racing it from the
 * outside: the fetch is actually aborted, the real error reaches the breaker,
 * and nothing keeps retrying after the caller has moved on.
 *
 * The signal MUST stay a factory. Given a bare AbortSignal the client swallows
 * the abort and synthesises a fake HTTP 200 whose body is `{result:"Aborted"}`;
 * given a factory it rethrows the real TimeoutError. Only the latter reaches
 * the breaker.
 */

const REQUEST_TIMEOUT_MS = 500
// How long to stay open before letting a single probe through. Long enough to
// not hammer a dead host, short enough that a transient blip self-heals well
// inside a serverless instance's lifetime.
const COOLDOWN_MS = 30_000

type BreakerState = 'closed' | 'open' | 'half-open'

let state: BreakerState = 'closed'
let openedAt = 0
let probeInFlight = false
let client: Redis | null | undefined

/**
 * Returns true if this call is allowed to touch Redis. In `half-open` exactly
 * one caller gets through as a probe; everyone else skips the cache until that
 * probe reports back via recordSuccess/recordFailure.
 */
function shouldAttempt(): boolean {
    if (state === 'open') {
        if (Date.now() - openedAt < COOLDOWN_MS) return false
        state = 'half-open'
        probeInFlight = false
    }

    if (state === 'half-open') {
        if (probeInFlight) return false
        probeInFlight = true
        return true
    }

    return true
}

function recordSuccess() {
    if (state !== 'closed') {
        console.info('[Circuit Breaker] Upstash Redis recovered. Caching re-enabled.')
    }
    state = 'closed'
    probeInFlight = false
}

function recordFailure(err: unknown, operation: string, key: string) {
    // Any failure trips the breaker — a timeout is just as disqualifying as a
    // DNS error, and distinguishing them was what broke this before.
    if (state !== 'open') {
        console.warn(
            `[Circuit Breaker] Upstash Redis ${operation} failed for ${key} (${err instanceof Error ? err.message : String(err)}). ` +
            `Caching disabled for ${COOLDOWN_MS / 1000}s.`
        )
    }
    state = 'open'
    openedAt = Date.now()
    probeInFlight = false
}

export const getRedis = (): Redis | null => {
    if (client !== undefined) return client

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        client = null
        return client
    }

    try {
        client = Redis.fromEnv({
            // Not literally "no retries" — the client reads `false` as one
            // immediate retry with zero backoff, vs. 5 with exponential backoff
            // (~4.5s). Either way the AbortSignal below caps the whole request.
            retry: false,
            // Must be a factory: it is invoked per request, so each call gets a
            // fresh deadline. See the note at the top of this file.
            signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
    } catch {
        client = null
    }

    return client
}

/**
 * Fetches with Upstash Redis as a hot-read cache, falling back to the fetcher
 * on a miss, an error, or while the circuit breaker is open.
 */
export async function fetchWithCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 300 // default 5 minutes
): Promise<T> {
    const redis = getRedis()
    if (!redis || !shouldAttempt()) {
        return fetcher()
    }

    try {
        const cached = await redis.get<T>(key)
        recordSuccess()
        // Only null/undefined mean "absent" — a cached 0, '' or false is a hit.
        if (cached !== null && cached !== undefined) {
            return cached
        }
    } catch (err) {
        recordFailure(err, 'get', key)
    }

    const freshData = await fetcher()

    // Re-check the breaker: the get above may have just opened it.
    if (freshData !== null && freshData !== undefined && shouldAttempt()) {
        try {
            await redis.set(key, freshData, { ex: ttlSeconds })
            recordSuccess()
        } catch (err) {
            recordFailure(err, 'set', key)
        }
    }

    return freshData
}

/**
 * Invalidates a specific cache key in both Redis (L2) and Next.js (L1).
 * It dynamically derives the Next.js cache tag by replacing colons with hyphens.
 */
export async function invalidateCache(key: string): Promise<void> {
    try {
        revalidateTag(key.replace(':', '-'), 'max')
    } catch (e) {
        console.warn(`revalidateTag failed for ${key}`, e)
    }

    const redis = getRedis()
    if (!redis || !shouldAttempt()) return

    try {
        await redis.del(key)
        recordSuccess()
    } catch (err) {
        recordFailure(err, 'del', key)
    }
}
