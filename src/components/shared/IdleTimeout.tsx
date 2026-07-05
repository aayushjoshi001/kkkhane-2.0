'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface IdleTimeoutProps {
    timeoutMs?: number // Default to 60 seconds
}

export default function IdleTimeout({ timeoutMs = 60000 }: IdleTimeoutProps) {
    const router = useRouter()
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const supabase = createClient()

    const resetTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
        
        timeoutRef.current = setTimeout(async () => {
            // Auto-lock the POS terminal
            await supabase.auth.signOut()
            router.refresh()
            router.push('/login?message=auto_locked')
        }, timeoutMs)
    }

    useEffect(() => {
        // Initialize
        resetTimeout()

        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
        const handleActivity = () => resetTimeout()

        events.forEach(event => {
            document.addEventListener(event, handleActivity, { passive: true })
        })

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
            events.forEach(event => {
                document.removeEventListener(event, handleActivity)
            })
        }
    }, [timeoutMs, router])

    return null // This is a headless component
}
