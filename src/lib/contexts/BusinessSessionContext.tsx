'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'

export interface BusinessSession {
    id: string
    date: string
    status: 'open' | 'closed'
    opening_balance: number
    opening_bank_balance: number
}

interface BusinessSessionContextType {
    session: BusinessSession | null
    isClosed: boolean
    isOpen: boolean
    canManage: boolean
    userRole: string
    todayDate: string
    loading: boolean
    /**
     * A business day still open for an earlier date — yesterday's day nobody
     * closed. Null in the normal case. It is tracked separately from `session`
     * because `session` is today's: once it refreshes, a stale day disappears
     * from view entirely, while it is still the thing blocking today from being
     * opened at all (see the POST in /api/day-book/session).
     */
    staleOpenSession: BusinessSession | null
    /** True while BusinessGuard's full-screen lock prompt is on top. */
    guardActive: boolean
    setGuardActive: (active: boolean) => void
    /** Opens the day. Takes no balances: the server carries the previous day's
     *  closing cash and bank balances over as the opening ones. */
    openBusiness: (date?: string) => Promise<boolean>
    /** Closes today's day, or the one whose id is passed — a stale day is not
     *  `session`, so the reminder has to name it. */
    closeBusiness: (sessionId?: string) => Promise<boolean>
    refreshSession: () => Promise<void>
}

const BusinessSessionContext = createContext<BusinessSessionContextType | null>(null)

export function BusinessSessionProvider({
    initialSession,
    userRole,
    todayDate,
    restaurantId,
    children,
}: {
    initialSession: BusinessSession | null
    userRole: string
    todayDate: string
    restaurantId?: string
    children: ReactNode
}) {
    const router = useRouter()
    const [session, setSession] = useState<BusinessSession | null>(initialSession)
    const [loading, setLoading] = useState(false)
    const [guardActive, setGuardActive] = useState(false)
    // The newest open day whatever its date, which `session` stops telling us
    // as soon as it refreshes to today's. Seeded from the server-rendered
    // session — the layouts pass the most recently created one, and a newer day
    // cannot exist while an older one is open (the POST refuses), so if that
    // one is open it is *the* open day. No fetch needed until it changes.
    const [openSessionAnyDate, setOpenSessionAnyDate] = useState<BusinessSession | null>(
        initialSession && initialSession.status === 'open' ? initialSession : null
    )

    // Derived states
    const isOpen = !!session && session.status === 'open'
    const isClosed = !isOpen
    const canManage = ['manager', 'super_admin', 'cashier'].includes(userRole)
    const staleOpenSession = openSessionAnyDate && openSessionAnyDate.date !== todayDate
        ? openSessionAnyDate
        : null

    const refreshOpenSession = useCallback(async () => {
        try {
            const res = await fetch('/api/day-book/session?open=1')
            const data = await res.json()
            if (!res.ok) return
            const row = data.data?.session
            setOpenSessionAnyDate(row ? {
                id: row.id,
                date: row.date,
                status: row.status,
                opening_balance: Number(row.opening_balance) || 0,
                opening_bank_balance: Number(row.opening_bank_balance) || 0,
            } : null)
        } catch {
            // keep current state on network failure
        }
    }, [])

    const refreshSession = useCallback(async () => {
        try {
            const res = await fetch(`/api/day-book/session?date=${todayDate}`)
            const data = await res.json()
            if (res.ok && data.data?.session) {
                setSession(data.data.session)
            } else if (res.status === 404) {
                setSession(null)
            }
        } catch {
            // keep current state on network failure
        }
        await refreshOpenSession()
    }, [todayDate, refreshOpenSession])

    // Realtime listener for business day session status changes across all windows/devices
    useEffect(() => {
        if (!restaurantId) return

        const supabase = createClient()
        const channel = supabase
            .channel(`business-session-${restaurantId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'day_book_sessions',
                    filter: `restaurant_id=eq.${restaurantId}`,
                },
                () => {
                    refreshSession()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [restaurantId, refreshSession])

    const openBusiness = async (date = todayDate): Promise<boolean> => {
        if (!canManage) {
            toast.error('Only managers, cashiers, and admins can open the business day')
            return false
        }

        setLoading(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // No balances: the route derives them from the last closed day.
                body: JSON.stringify({ date }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to open business day')

            setSession(data.data)
            await refreshOpenSession()
            toast.success('Business day opened successfully! All panels are now active.')
            router.refresh()
            return true
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Failed to open business day')
            return false
        } finally {
            setLoading(false)
        }
    }

    const closeBusiness = async (sessionId?: string): Promise<boolean> => {
        const targetId = sessionId ?? session?.id
        if (!targetId) return false
        if (!canManage) {
            toast.error('Only managers, cashiers, and admins can close the business day')
            return false
        }

        setLoading(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: targetId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to close business day')

            if (session && targetId === session.id) setSession({ ...session, status: 'closed' })
            await refreshOpenSession()
            toast.success('Business day closed. All panels are locked.')
            router.refresh()
            return true
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Failed to close business day')
            return false
        } finally {
            setLoading(false)
        }
    }

    return (
        <BusinessSessionContext.Provider
            value={{
                session,
                isClosed,
                isOpen,
                canManage,
                userRole,
                todayDate,
                loading,
                staleOpenSession,
                guardActive,
                setGuardActive,
                openBusiness,
                closeBusiness,
                refreshSession,
            }}
        >
            {children}
        </BusinessSessionContext.Provider>
    )
}

export function useBusinessSession() {
    const context = useContext(BusinessSessionContext)
    if (!context) {
        // Return default safe fallback when context is not provided
        return {
            session: null,
            isClosed: false,
            isOpen: true,
            canManage: true,
            userRole: 'manager',
            todayDate: '',
            loading: false,
            staleOpenSession: null,
            guardActive: false,
            setGuardActive: () => {},
            openBusiness: async () => false,
            closeBusiness: async () => false,
            refreshSession: async () => {},
        }
    }
    return context
}
