/**
 * Rate Limiting Utility
 * Uses Upstash Redis for serverless-safe rate limiting
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { headers } from 'next/headers'

// Singleton rate limiters for different endpoints
const _ratelimiters: Map<string, Ratelimit | null> = new Map()

/**
 * Get or create a rate limiter for a specific endpoint
 * @param key Unique identifier for the rate limit rule
 * @param requests Maximum requests allowed
 * @param windowSeconds Time window in seconds
 */
export function getRatelimit(key: string, requests: number = 10, windowSeconds: number = 60): Ratelimit | null {
  if (_ratelimiters.has(key)) {
    return _ratelimiters.get(key) || null
  }

  try {
    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`),
      analytics: true,
      prefix: `srms:ratelimit:${key}`,
    })
    _ratelimiters.set(key, ratelimit)
    return ratelimit
  } catch (error) {
    console.warn(`Rate limiting not configured for ${key}:`, error instanceof Error ? error.message : 'Unknown error')
    _ratelimiters.set(key, null)
    return null
  }
}

/**
 * Get IP address from request headers
 * Works with both direct requests and proxied requests (Vercel, Cloudflare, etc.)
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers()
  return (
    headersList.get('x-forwarded-for')?.split(',')[0].trim() ||
    headersList.get('x-real-ip') ||
    headersList.get('cf-connecting-ip') ||
    'unknown'
  )
}

/**
 * Rate limit middleware for Server Actions
 * Returns null if request is allowed, error message if rate limited
 * Fails gracefully if Upstash is not available
 */
export async function checkRateLimit(key: string, requests: number = 10, windowSeconds: number = 60): Promise<string | null> {
  const ratelimit = getRatelimit(key, requests, windowSeconds)
  if (!ratelimit) {
    // Rate limiting disabled (Upstash not configured)
    return null
  }

  try {
    const ip = await getClientIp()
    // Race the limiter against an 800ms budget. Upstash is a network hop and a
    // cold edge/region can take seconds — without this a slow Redis stalls every
    // login/checkout it guards. Timing out fails open (same as an error), which
    // is acceptable: the limiter is a DoS backstop, not an auth gate.
    const TIMEOUT = Symbol('rl-timeout')
    const response = await Promise.race([
      ratelimit.limit(ip),
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), 800)),
    ])

    if (response === TIMEOUT) {
      console.warn(`Rate limit check timed out for ${key} — allowing request`)
      return null
    }

    if (!response.success) {
      const resetTime = response.reset ? new Date(response.reset).getTime() - Date.now() : 60000
      return `Rate limit exceeded. Try again in ${Math.ceil(resetTime / 1000)} seconds.`
    }

    return null
  } catch (error) {
    console.warn(`Rate limit check failed for ${key}:`, error instanceof Error ? error.message : 'Unknown error')
    // Fail open - allow the request if rate limiting fails
    return null
  }
}

/**
 * Predefined rate limit rules for common endpoints
 * Times are in seconds
 */
export const RATE_LIMIT_RULES = {
  // Auth endpoints
  LOGIN: { requests: 5, windowSeconds: 900 } as const, // 15 minutes
  SIGNUP: { requests: 3, windowSeconds: 3600 } as const, // 1 hour
  PASSWORD_RESET: { requests: 3, windowSeconds: 3600 } as const, // 1 hour

  // Checkout & payments
  CHECKOUT: { requests: 5, windowSeconds: 60 } as const, // 1 minute
  PAYMENT_CLAIM: { requests: 3, windowSeconds: 300 } as const, // 5 minutes

  // API endpoints
  API_ORDERS: { requests: 50, windowSeconds: 60 } as const, // 1 minute
  API_GENERAL: { requests: 100, windowSeconds: 60 } as const, // 1 minute

  // Loyalty & redemption
  LOYALTY_SIGNUP: { requests: 10, windowSeconds: 3600 } as const, // 1 hour
  LOYALTY_REDEEM: { requests: 5, windowSeconds: 60 } as const, // 1 minute

  // Service requests
  SERVICE_REQUEST: { requests: 5, windowSeconds: 60 } as const, // 1 minute

  // Admin operations
  ADMIN_CREATE_TENANT: { requests: 5, windowSeconds: 3600 } as const, // 1 hour
  ADMIN_UPDATE: { requests: 30, windowSeconds: 60 } as const, // 1 minute
} as const

export type RateLimitKey = keyof typeof RATE_LIMIT_RULES
