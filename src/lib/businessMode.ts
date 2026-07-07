// lib/businessMode.ts
// Groups the 8 onboarding business types into 4 operational modes that
// actually drive different feature defaults, seed data, and nav visibility
// (see buildFeaturesV2 in lib/tiers.ts and provisionRestaurant in
// lib/provisioning.ts). business_type itself stays the single source of
// truth (editable at onboarding and in Settings) — mode is always derived
// from it, never stored separately, so the two can't drift out of sync.

export type BusinessMode = 'dine_in' | 'counter_service' | 'bar_service' | 'delivery_only' | 'hotel'

export const ONBOARDING_BUSINESS_TYPES = [
    'FastFood', 'Fine Dining', 'Cafe', 'Bar', 'Cloud Kitchen', 'Resort/Hotel', 'Bakery', 'Restaurant',
] as const

// Map business type to operational mode. Resort/Hotel is mapped to 'hotel' mode
// which drives room and reservation management rather than dining tables.
export const BUSINESS_TYPE_TO_MODE: Record<typeof ONBOARDING_BUSINESS_TYPES[number], BusinessMode> = {
    'Restaurant': 'dine_in',
    'Fine Dining': 'dine_in',
    'Resort/Hotel': 'hotel',
    'Cafe': 'counter_service',
    'Bakery': 'counter_service',
    'FastFood': 'counter_service',
    'Bar': 'bar_service',
    'Cloud Kitchen': 'delivery_only',
}

export function getBusinessMode(businessType: string | null | undefined): BusinessMode {
    if (!businessType) return 'dine_in'
    return (BUSINESS_TYPE_TO_MODE as Record<string, BusinessMode | undefined>)[businessType] ?? 'dine_in'
}
