import { Redis } from '@upstash/redis'

export const getRedis = (): Redis | null => {
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
            return null
        }
        return Redis.fromEnv()
    } catch (e) {
        return null
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
    
    // Fallback if Redis is not configured or throws on init
    if (!redis) {
        return fetcher()
    }

    try {
        const cached = await redis.get<T>(key)
        if (cached) {
            return cached
        }
    } catch (err) {
        console.warn(`Redis get error for ${key}:`, err)
        // fail open
    }

    // Cache Miss or Error: Fetch fresh data
    const freshData = await fetcher()

    try {
        if (freshData) {
            await redis.set(key, freshData, { ex: ttlSeconds })
        }
    } catch (err) {
        console.warn(`Redis set error for ${key}:`, err)
    }

    return freshData
}

/**
 * Invalidates a specific cache key
 */
export async function invalidateCache(key: string): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
        await redis.del(key)
    } catch (err) {
        console.warn(`Redis del error for ${key}:`, err)
    }
}
