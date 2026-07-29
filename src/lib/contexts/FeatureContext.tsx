'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Settings } from '@/types/database'
import { formatCurrency } from '@/lib/utils'
import { useDates } from '@/lib/contexts/CalendarContext'
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
    financeEnabled: false,
    printInvoiceEnabled: true,
    generateInvoiceEnabled: true,
    staffManagementEnabled: true,
    tableManagementEnabled: true,
    irdSyncEnabled: false,
    kotEnabled: false,
    kdsEnabled: true,
}

const FeatureContext = createContext<Features>(defaultFeatures)

export function FeatureProvider({ features, children }: { features: Features | null; children: ReactNode }) {
    const rawFeatures = features ?? defaultFeatures
    const isIrd = !!rawFeatures.irdSyncEnabled
    const resolvedFeatures: Features = {
        ...rawFeatures,
        financeEnabled: isIrd ? true : (rawFeatures.financeEnabled ?? false),
        generateInvoiceEnabled: isIrd ? true : (rawFeatures.generateInvoiceEnabled ?? true),
        printInvoiceEnabled: isIrd ? true : (rawFeatures.printInvoiceEnabled ?? true),
        vatEnabled: isIrd ? rawFeatures.vatEnabled : false,
        kdsEnabled: rawFeatures.kotEnabled ? false : (rawFeatures.kdsEnabled ?? true),
    }

    return (
        <FeatureContext.Provider value={resolvedFeatures}>
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
    const val = features[key]
    if (val === undefined) {
        const defaultTrueKeys: string[] = [
            'promosEnabled',
            'feedbackEnabled',
            'dineInEnabled',
            'serviceRequestsEnabled',
            'splitBillingEnabled',
            'printInvoiceEnabled',
            'generateInvoiceEnabled',
            'staffManagementEnabled',
            'tableManagementEnabled',
            'manualEntryEnabled',
            'printBillEnabled',
            'showInvoiceEnabled'
        ]
        return defaultTrueKeys.includes(key)
    }
    return !!val
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
 * @deprecated Prefer `useDates()` from `@/lib/contexts/CalendarContext`, which
 * also gives you `formatDateTime` and `formatDateShort` in the same calendar.
 *
 * Kept as a thin alias so the call sites that already use it keep working. It
 * used to hang off the per-restaurant "Bikram Sambat Date" flag and appended BS
 * in brackets after AD; dates now lead with Bikram Sambat by default and follow
 * each user's own calendar toggle instead.
 */
export function useDateFormatter(): (date: string | Date) => string {
    return useDates().formatDate
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
