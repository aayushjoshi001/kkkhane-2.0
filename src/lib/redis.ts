import { Redis } from '@upstash/redis'
import { revalidateTag } from 'next/cache'

// Circuit breaker: if Upstash is unreachable (e.g., wrong URL or offline),
// we disable it in memory to prevent spamming the console and adding latency
// to every single request.
let redisDisabled = false

export const getRedis = (): Redis | null => {
    if (redisDisabled) return null
    
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
            return null
        }
        return Redis.fromEnv()
    } catch (e) {
        return null
    }
}

function handleRedisError(err: any, operation: string, key: string) {
    if (err instanceof Error && err.message.includes('fetch failed')) {
        if (!redisDisabled) {
            console.warn(`[Circuit Breaker] Upstash Redis is unreachable (${err.message}). Caching disabled for this instance.`)
            redisDisabled = true
        }
    } else {
        console.warn(`Redis ${operation} error for ${key}:`, err)
    }
}

/**
 * Professional wrapper for fetching data with Upstash Redis as a hot-read cache.
 * Falls back to the fetcher and sets the cache if there is a miss.
 * Fails open if Redis is unreachable (fetches directly).
 */
export async function fetchWithCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 300 // default 5 minutes
): Promise<T> {
    const redis = getRedis()
    
    // Fallback if Redis is not configured or disabled by circuit breaker
    if (!redis) {
        return fetcher()
    }

    try {
        // Enforce a strict 500ms timeout on Redis calls. 
        // If Upstash is cold-starting, it can take 3-5 seconds. A cache should never slow down the app.
        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Redis timeout')), 500)
        )
        const cached = await Promise.race([redis.get<T>(key), timeoutPromise])
        if (cached) {
            return cached
        }
    } catch (err) {
        handleRedisError(err, 'get', key)
    }

    // Cache Miss or Error (or Timeout): Fetch fresh data
    const freshData = await fetcher()

    try {
        if (freshData && !redisDisabled) {
            const timeoutPromise = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('Redis set timeout')), 500)
            )
            await Promise.race([
                redis.set(key, freshData, { ex: ttlSeconds }),
                timeoutPromise
            ])
        }
    } catch (err) {
        handleRedisError(err, 'set', key)
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
    if (!redis) return

    try {
        await redis.del(key)
    } catch (err) {
        handleRedisError(err, 'del', key)
    }
}
