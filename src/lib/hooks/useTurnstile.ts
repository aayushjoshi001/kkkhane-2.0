import { useCallback, useEffect, useRef, useState } from 'react'

const TIMEOUT_MS = 10000

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

/**
 * Wraps Turnstile token state with a timeout so a widget that never loads
 * (blocked network, slow/absent IPv6 path to Cloudflare's challenge platform, etc.)
 * doesn't leave the submit button disabled forever.
 */
export function useTurnstile(timeoutMs = TIMEOUT_MS) {
    const [token, setToken] = useState<string | null>(null)
    const [timedOut, setTimedOut] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) return

        timerRef.current = setTimeout(() => setTimedOut(true), timeoutMs)
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [timeoutMs])

    const handleSuccess = useCallback((t: string) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        setTimedOut(false)
        setToken(t)
    }, [])

    const handleExpire = useCallback(() => {
        setToken(null)
    }, [])

    const handleError = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
        setTimedOut(true)
    }, [])

    // Blocks submission only while the widget is still expected to produce a token.
    const isBlocking = !!TURNSTILE_SITE_KEY && !token && !timedOut
    const unavailable = !!TURNSTILE_SITE_KEY && !token && timedOut

    return { token, isBlocking, unavailable, handleSuccess, handleExpire, handleError }
}
