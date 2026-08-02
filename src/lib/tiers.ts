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

/**
 * Which major modules each plan includes.
 *
 * These flags gate whole sections of the admin panel, and they were missing
 * from TIER_FEATURES entirely — so buildFeaturesV2 never wrote them, every
 * restaurant had the keys absent rather than set, and the server treated
 * absent as "off" while the client treated it as "on". The result was a
 * sidebar link to a page that redirected straight back to the dashboard, with
 * no way for a manager to fix it.
 *
 * Grounded in the published plans in lib/pricing.ts: every tier down to Free
 * advertises user logins and a table count, so staff and table management are
 * available on all of them — the Premium differentiator is *custom roles*, not
 * having staff records at all. Accounting is Premium and above, matching
 * FINANCE_TIERS above.
 */
export const TIER_MODULES: Record<Tier, {
    staffManagementEnabled: boolean
    tableManagementEnabled: boolean
    financeEnabled: boolean
}> = {
    free:       { staffManagementEnabled: true, tableManagementEnabled: true, financeEnabled: false },
    basic:      { staffManagementEnabled: true, tableManagementEnabled: true, financeEnabled: false },
    premium:    { staffManagementEnabled: true, tableManagementEnabled: true, financeEnabled: true  },
    platinum:   { staffManagementEnabled: true, tableManagementEnabled: true, financeEnabled: true  },
    enterprise: { staffManagementEnabled: true, tableManagementEnabled: true, financeEnabled: true  },
}

/** The module flags, as a list — for callers that need to iterate them. */
export const MODULE_KEYS = [
    'staffManagementEnabled',
    'tableManagementEnabled',
    'financeEnabled',
] as const

export type ModuleKey = typeof MODULE_KEYS[number]

/**
 * Whether a module is on by default once the plan allows it.
 *
 * Entitlement and default state are separate questions. Staff and table
 * management are core to running the place, so they are on unless someone
 * turns them off — which is also what the client has always assumed for them.
 * Accounting is a substantial module a restaurant opts into; a plan including
 * it means the manager *may* switch it on, not that it appears unannounced.
 */
export const MODULE_DEFAULT_ON: Record<ModuleKey, boolean> = {
    staffManagementEnabled: true,
    tableManagementEnabled: true,
    financeEnabled: false,
}

/** Does this plan include the given module? Unknown tiers fall back to Free. */
export function tierIncludesModule(tier: Tier | string | null | undefined, key: ModuleKey): boolean {
    const modules = TIER_MODULES[tier as Tier] ?? TIER_MODULES.free
    return modules[key]
}

/**
 * Fill in module flags the stored settings never wrote.
 *
 * The single place a missing module flag is resolved. Both the server
 * (getRestaurantFeatures) and anything rendering from it go through here, so
 * the two can no longer reach opposite conclusions about the same absent key —
 * which is the bug that made the staff page unreachable.
 *
 * An explicitly stored value always wins, so a tenant who has deliberately
 * switched a module off keeps it off. Only a plan that does not include the
 * module can override that, since entitlement outranks preference.
 */
export function applyTierModuleDefaults<T extends Record<string, unknown>>(
    features: T,
    tier: Tier | string | null | undefined,
): T & Record<ModuleKey, boolean> {
    const resolved = { ...features } as T & Record<ModuleKey, boolean>
    for (const key of MODULE_KEYS) {
        if (!tierIncludesModule(tier, key)) {
            resolved[key] = false
            continue
        }
        const stored = features[key]
        resolved[key] = stored === undefined ? MODULE_DEFAULT_ON[key] : !!stored
    }
    return resolved
}

/**
 * Flags that mean "on" when the stored settings never wrote them.
 *
 * The same absent-key disagreement that made the staff page unreachable was
 * live for every flag on this list: the sidebar and FeatureContext read an
 * absent key as on (`?? true`), while the server page gates read it as off
 * (`!features?.x`). A super admin would switch Manual Finance Entry on, see it
 * green — the settings form seeds the same `true` default, so nothing was ever
 * written — and the tenant would still bounce off /admin/manual-entry.
 *
 * MODULE_KEYS are deliberately absent here: those are plan-gated and resolved
 * by applyTierModuleDefaults, which must be free to revoke them.
 */
export const DEFAULT_ON_FEATURES = [
    'promosEnabled',
    'feedbackEnabled',
    'dineInEnabled',
    'serviceRequestsEnabled',
    'splitBillingEnabled',
    'printInvoiceEnabled',
    'generateInvoiceEnabled',
    'manualEntryEnabled',
    'printBillEnabled',
    'showInvoiceEnabled',
    'kdsEnabled',
    // The kitchen gets both halves out of the box: a screen to work from and a
    // ticket at the pass. They used to be exclusive, so a tenant provisioned
    // without the keys silently had no auto-print at all and no way to notice —
    // placing an order simply produced no paper and no error.
    'kotEnabled',
] as const

export type DefaultOnFeature = typeof DEFAULT_ON_FEATURES[number]

/**
 * Fill in the default-on flags the stored settings never wrote.
 *
 * The single place an absent non-module flag is resolved, so the server and the
 * client can no longer reach opposite conclusions about the same missing key.
 * An explicitly stored value always wins.
 */
export function resolveFeatureDefaults<T extends Record<string, unknown>>(
    features: T,
): T & Record<DefaultOnFeature, boolean> {
    const resolved = { ...features } as T & Record<DefaultOnFeature, boolean>
    for (const key of DEFAULT_ON_FEATURES) {
        const stored = features[key]
        resolved[key] = stored === undefined ? true : !!stored
    }
    return resolved
}

/**
 * The paid capabilities a plan grants — as opposed to the behavioural
 * preferences that also live in TIER_FEATURES (waiter sessions, order
 * confirmation, split billing…), which are the tenant's to set and must
 * survive a plan change untouched.
 *
 * Only these are re-applied when a subscription tier changes.
 */
export const TIER_ENTITLEMENTS = [
    'loyaltyEnabled',
    'promosEnabled',
    'takeoutEnabled',
    'multiLanguageEnabled',
    'dynamicPricingEnabled',
    'ingredientTrackingEnabled',
    'staffShiftsEnabled',
] as const

export type TierEntitlement = typeof TIER_ENTITLEMENTS[number]

/** Does this plan include the given paid capability? Unknown tiers fall back to Free. */
export function tierIncludesEntitlement(
    tier: Tier | string | null | undefined,
    key: TierEntitlement,
): boolean {
    const features = TIER_FEATURES[tier as Tier] ?? TIER_FEATURES.free
    return !!features[key]
}

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
        // Written explicitly at provisioning rather than left absent — an
        // absent flag is what the server and client used to disagree about.
        ...applyTierModuleDefaults({}, tier),
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
        // Both halves of the kitchen, on by default. These were absent from
        // this object entirely, so every restaurant provisioned since launch
        // stored neither key — and absent kotEnabled reads as off, which is
        // why a new tenant's KOT never printed until a super admin noticed.
        kotEnabled: true,
        kdsEnabled: true,
    }
}

/**
 * Re-apply a plan's paid capabilities to already-stored flags.
 *
 * Changing the subscription tier used to move the caps and the three module
 * flags and nothing else, so a restaurant moved up to Enterprise kept the
 * loyalty/inventory/shifts/dynamic-pricing flags its original Free
 * provisioning had written `false` — the customer had paid for modules the app
 * still refused to show, and no screen could turn them on.
 *
 * The business mode still wins over the tier: a hotel does not get takeout
 * because it was upgraded. Behavioural preferences outside TIER_ENTITLEMENTS
 * are never touched.
 */
export function applyTierEntitlements<T extends Record<string, unknown>>(
    features: T,
    tier: Tier | string | null | undefined,
    mode: BusinessMode,
): T & Record<TierEntitlement, boolean> {
    const modeOverlay = MODE_FEATURES[mode] as Record<string, unknown>
    const resolved = { ...features } as T & Record<TierEntitlement, boolean>
    for (const key of TIER_ENTITLEMENTS) {
        // A mode that has an opinion about this flag keeps it — the overlay is
        // about what the business physically does, not what it has bought.
        if (modeOverlay[key] !== undefined) {
            resolved[key] = !!modeOverlay[key]
            continue
        }
        resolved[key] = tierIncludesEntitlement(tier, key)
    }
    return resolved
}
