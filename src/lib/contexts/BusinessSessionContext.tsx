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
    openBusiness: (date?: string, openingBalance?: number, openingBankBalance?: number) => Promise<boolean>
    closeBusiness: () => Promise<boolean>
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

    // Derived states
    const isOpen = !!session && session.status === 'open'
    const isClosed = !isOpen
    const canManage = ['manager', 'super_admin', 'cashier'].includes(userRole)

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
    }, [todayDate])

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

    const openBusiness = async (
        date = todayDate,
        openingBalance = 0,
        openingBankBalance = 0
    ): Promise<boolean> => {
        if (!canManage) {
            toast.error('Only managers, cashiers, and admins can open the business day')
            return false
        }

        setLoading(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date,
                    opening_balance: openingBalance,
                    opening_bank_balance: openingBankBalance,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to open business day')

            setSession(data.data)
            toast.success('Business day opened successfully! All panels are now active.')
            router.refresh()
            return true
        } catch (e: any) {
            toast.error(e.message || 'Failed to open business day')
            return false
        } finally {
            setLoading(false)
        }
    }

    const closeBusiness = async (): Promise<boolean> => {
        if (!session) return false
        if (!canManage) {
            toast.error('Only managers, cashiers, and admins can close the business day')
            return false
        }

        setLoading(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session.id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to close business day')

            setSession({ ...session, status: 'closed' })
            toast.success('Business day closed. All panels are locked.')
            router.refresh()
            return true
        } catch (e: any) {
            toast.error(e.message || 'Failed to close business day')
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
            openBusiness: async () => false,
            closeBusiness: async () => false,
            refreshSession: async () => {},
        }
    }
    return context
}
