// lib/tiers.ts
// Single source of truth for subscription tier limits + default feature flags.
// Previously these constants were duplicated (and drifting) between
// src/app/signup/actions.ts and src/app/(onboarding)/onboarding/create/actions.ts.

import type { BusinessMode } from '@/lib/businessMode'

export type Tier = 'free' | 'basic' | 'premium' | 'platinum' | 'enterprise'

/**
 * "Unlimited" has to survive a write into restaurants.max_staff etc., which are
 * int4 — so it is int4's ceiling, not Infinity. Compare with isUnlimited()
 * rather than testing against the magic number.
 */
export const UNLIMITED = 2_147_483_647

export const isUnlimited = (limit: number): boolean => limit >= UNLIMITED

/** Enforced caps. Must stay in step with the published plans in lib/pricing.ts. */
export const TIER_LIMITS: Record<Tier, { max_staff: number; max_menu_items: number; max_tables: number }> = {
    free:       { max_staff: 3,        max_menu_items: 100,      max_tables: 10        },
    basic:      { max_staff: 5,        max_menu_items: 500,      max_tables: 20        },
    premium:    { max_staff: 24,       max_menu_items: 1000,     max_tables: 50        },
    platinum:   { max_staff: UNLIMITED, max_menu_items: UNLIMITED, max_tables: UNLIMITED },
    enterprise: { max_staff: UNLIMITED, max_menu_items: UNLIMITED, max_tables: UNLIMITED },
}

/** Tiers whose plan includes the accounting/finance module. */
export const FINANCE_TIERS: readonly Tier[] = ['premium', 'platinum', 'enterprise']

/** Every tier, cheapest first — the order admin pickers render them in. */
export const TIERS: readonly Tier[] = ['free', 'basic', 'premium', 'platinum', 'enterprise']

export const TIER_LABELS: Record<Tier, string> = {
    free: 'Free',
    basic: 'Basic',
    premium: 'Premium',
    platinum: 'Platinum',
    enterprise: 'Enterprise',
}

export const TIER_FEATURES: Record<Tier, {
    loyaltyEnabled: boolean
    promosEnabled: boolean
    takeoutEnabled: boolean
    multiLanguageEnabled: boolean
    serviceRequestsEnabled: boolean
    splitBillingEnabled: boolean
    dynamicPricingEnabled: boolean
    ingredientTrackingEnabled: boolean
    staffShiftsEnabled: boolean
    // When true, a waiter must open a table session before guests can order.
    // When false (default), sessions auto-open on QR scan (self-service ordering).
    waiterSessionEnabled: boolean
    // When true (low plans), placed dine-in orders wait for waiter confirmation
    // before reaching the kitchen. Premium tiers default to direct-to-kitchen.
    waiterOrderConfirmation: boolean
    printInvoiceEnabled: boolean
    generateInvoiceEnabled: boolean
}> = {
    free: {
        loyaltyEnabled: false, promosEnabled: true, takeoutEnabled: false,
        multiLanguageEnabled: false, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false, staffShiftsEnabled: false,
        waiterSessionEnabled: false, waiterOrderConfirmation: true,
        printInvoiceEnabled: true, generateInvoiceEnabled: true,
    },
    basic: {
        loyaltyEnabled: false, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: false, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false, staffShiftsEnabled: false,
        waiterSessionEnabled: false, waiterOrderConfirmation: true,
        printInvoiceEnabled: true, generateInvoiceEnabled: true,
    },
    premium: {
        loyaltyEnabled: true, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: false, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true, staffShiftsEnabled: true,
        waiterSessionEnabled: false, waiterOrderConfirmation: false,
        printInvoiceEnabled: true, generateInvoiceEnabled: true,
    },
    platinum: {
        loyaltyEnabled: true, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: true, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true, staffShiftsEnabled: true,
        waiterSessionEnabled: false, waiterOrderConfirmation: false,
        printInvoiceEnabled: true, generateInvoiceEnabled: true,
    },
    enterprise: {
        loyaltyEnabled: true, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: true, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true, staffShiftsEnabled: true,
        waiterSessionEnabled: false, waiterOrderConfirmation: false,
        printInvoiceEnabled: true, generateInvoiceEnabled: true,
    },
}

/** Default theme applied to every newly-provisioned restaurant. */
export const DEFAULT_THEME = {
    primaryColor: '#FB6303',
    secondaryColor: '#1B263B',
    fontFamily: 'Inter',
    borderRadius: '12px',
    menuLayout: 'grid',
} as const

/** Legacy v1 features object (kept for backward compatibility with settings.features). */
export const DEFAULT_FEATURES_V1 = {
    tipsEnabled: true,
    feedbackEnabled: true,
    geofenceEnabled: false,
    geofenceRadiusMeters: 100,
} as const

/**
 * Per-business-mode overrides layered on top of TIER_FEATURES — see
 * lib/businessMode.ts for how a restaurant's business_type maps to one of
 * these. Only keys with a clear, defensible behavioral difference per mode
 * are here; everything else (loyalty/promos/ingredient tracking/staff
 * shifts) stays purely tier-driven.
 *
 * dynamicPricingEnabled is deliberately NOT overridden for bar_service here:
 * forcing it on would grant a paid (pro/enterprise) feature to a free/basic
 * bar for free, so bars simply keep whatever their tier already grants —
 * identical to every other mode for this one flag.
 */
const MODE_FEATURES: Record<BusinessMode, {
    dineInEnabled: boolean
    takeoutEnabled?: boolean
    waiterSessionEnabled?: boolean
    waiterOrderConfirmation?: boolean
    splitBillingEnabled?: boolean
    serviceRequestsEnabled?: boolean
    quickServeItems?: string[]
}> = {
    dine_in: {
        dineInEnabled: true,
        quickServeItems: ['Water', 'Tissue'],
    },
    counter_service: {
        dineInEnabled: true,
        takeoutEnabled: true,
        waiterSessionEnabled: false,
        waiterOrderConfirmation: false,
        quickServeItems: ['Napkins', 'Water'],
    },
    bar_service: {
        dineInEnabled: true,
        splitBillingEnabled: true,
        quickServeItems: ['Water', 'Ice'],
    },
    delivery_only: {
        dineInEnabled: false,
        takeoutEnabled: true,
        waiterSessionEnabled: false,
        waiterOrderConfirmation: false,
        splitBillingEnabled: false,
        serviceRequestsEnabled: false,
        quickServeItems: [],
    },
    hotel: {
        dineInEnabled: false,
        takeoutEnabled: false,
        waiterSessionEnabled: false,
        waiterOrderConfirmation: false,
        splitBillingEnabled: false,
        serviceRequestsEnabled: true,
        quickServeItems: ['Water', 'Towel', 'Housekeeping'],
    },
}

/** Build the full features_v2 object for a given tier + business mode (Nepal defaults). */
export function buildFeaturesV2(tier: Tier, mode: BusinessMode) {
    const modeOverlay = { ...MODE_FEATURES[mode] }

    return {
        ...TIER_FEATURES[tier],
        ...modeOverlay,
        defaultTaxRate: 13,
        currency: 'NPR',
        currencySymbol: 'Rs.',
        nepalPayEnabled: true,
        vatEnabled: false,
        phoneOtpEnabled: false,
        bsDateEnabled: false,
        tipsEnabled: true,
        feedbackEnabled: true,
        geofenceEnabled: false,
        geofenceRadiusMeters: 100,
        // Phase 3: customers may request a waiter open their table session.
        selfOrderRequestEnabled: true,
    }
}
