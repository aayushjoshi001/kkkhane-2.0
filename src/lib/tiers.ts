// lib/tiers.ts
// Single source of truth for subscription tier limits + default feature flags.
// Previously these constants were duplicated (and drifting) between
// src/app/signup/actions.ts and src/app/(onboarding)/onboarding/create/actions.ts.

export type Tier = 'free' | 'basic' | 'pro' | 'enterprise'

export const TIER_LIMITS: Record<Tier, { max_staff: number; max_menu_items: number; max_tables: number }> = {
    free:       { max_staff: 3,   max_menu_items: 20,   max_tables: 10  },
    basic:      { max_staff: 10,  max_menu_items: 100,  max_tables: 30  },
    pro:        { max_staff: 50,  max_menu_items: 500,  max_tables: 100 },
    enterprise: { max_staff: 999, max_menu_items: 9999, max_tables: 999 },
}

const TIER_FEATURES: Record<Tier, {
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
}> = {
    free: {
        loyaltyEnabled: false, promosEnabled: true, takeoutEnabled: false,
        multiLanguageEnabled: false, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false, staffShiftsEnabled: false,
        waiterSessionEnabled: false, waiterOrderConfirmation: true,
    },
    basic: {
        loyaltyEnabled: false, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: false, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false, staffShiftsEnabled: false,
        waiterSessionEnabled: false, waiterOrderConfirmation: true,
    },
    pro: {
        loyaltyEnabled: true, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: false, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true, staffShiftsEnabled: true,
        waiterSessionEnabled: false, waiterOrderConfirmation: false,
    },
    enterprise: {
        loyaltyEnabled: true, promosEnabled: true, takeoutEnabled: true,
        multiLanguageEnabled: true, serviceRequestsEnabled: true,
        splitBillingEnabled: true, dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true, staffShiftsEnabled: true,
        waiterSessionEnabled: false, waiterOrderConfirmation: false,
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

/** Build the full features_v2 object for a given tier (Nepal defaults). */
export function buildFeaturesV2(tier: Tier) {
    return {
        ...TIER_FEATURES[tier],
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
        // Manager-configurable one-tap service items (editable in Settings).
        quickServeItems: ['Water', 'Tissue'] as string[],
    }
}
