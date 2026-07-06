'use client'

import { createContext, useContext, ReactNode } from 'react'

// menu_item_id -> ranked list of paired menu_item_ids ("pairs well with"),
// precomputed nightly from order co-occurrence. See refresh_menu_item_pairings().
export type PairingMap = Record<string, string[]>

const RecommendationsContext = createContext<PairingMap>({})

export function RecommendationsProvider({ children, pairings }: { children: ReactNode; pairings: PairingMap }) {
    return (
        <RecommendationsContext.Provider value={pairings}>
            {children}
        </RecommendationsContext.Provider>
    )
}

export function useRecommendedItemIds(menuItemId: string): string[] {
    const pairings = useContext(RecommendationsContext)
    return pairings[menuItemId] || []
}
