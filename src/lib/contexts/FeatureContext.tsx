'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Settings } from '@/types/database'
import { formatCurrency } from '@/lib/utils'
import type { BusinessMode } from '@/lib/businessMode'

type Features = Settings['features_v2']

const defaultFeatures: Features = {
    loyaltyEnabled: false,
    promosEnabled: true,
    takeoutEnabled: false,
    dineInEnabled: true,
    multiLanguageEnabled: false,
    serviceRequestsEnabled: true,
    splitBillingEnabled: true,
    dynamicPricingEnabled: false,
    ingredientTrackingEnabled: false,
    staffShiftsEnabled: false,
    defaultTaxRate: 13.0,
    currency: 'NPR',
    currencySymbol: 'Rs.',
    nepalPayEnabled: false,
    vatEnabled: false,
    phoneOtpEnabled: false,
    bsDateEnabled: false,
        feedbackEnabled: true,
}

const FeatureContext = createContext<Features>(defaultFeatures)

export function FeatureProvider({ features, children }: { features: Features | null; children: ReactNode }) {
    return (
        <FeatureContext.Provider value={features ?? defaultFeatures}>
            {children}
        </FeatureContext.Provider>
    )
}

export function useFeatures(): Features {
    return useContext(FeatureContext)
}

/**
 * Hook to check if a specific feature is enabled.
 * Usage: const isEnabled = useFeatureEnabled('loyaltyEnabled')
 */
export function useFeatureEnabled(key: keyof Omit<Features, 'defaultTaxRate' | 'currency' | 'currencySymbol'>): boolean {
    const features = useFeatures()
    return !!features[key]
}

/**
 * Currency formatter bound to the restaurant's configured currency/symbol.
 * Use this everywhere a price is shown so the whole app reflects the single
 * currency set in admin settings (no Rs./$ mix).
 *
 * Usage:
 *   const money = useCurrency()
 *   <span>{money(order.total_amount)}</span>
 */
export function useCurrency(): (amount: number) => string {
    const { currency, currencySymbol } = useFeatures()
    return useMemo(
        () => (amount: number) => formatCurrency(amount, currency, currencySymbol),
        [currency, currencySymbol],
    )
}

/**
 * The restaurant's operational mode (dine_in/counter_service/bar_service/
 * delivery_only), derived from business_type — see lib/businessMode.ts.
 * Kept as a separate context from Features so existing useFeatures()/
 * useFeatureEnabled() call sites are unaffected.
 */
const BusinessModeContext = createContext<BusinessMode>('dine_in')

export function BusinessModeProvider({ mode, children }: { mode: BusinessMode; children: ReactNode }) {
    return (
        <BusinessModeContext.Provider value={mode}>
            {children}
        </BusinessModeContext.Provider>
    )
}

export function useBusinessMode(): BusinessMode {
    return useContext(BusinessModeContext)
}
