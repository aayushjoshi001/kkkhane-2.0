// lib/businessMode.ts
// Groups the 8 onboarding business types into 4 operational modes that
// actually drive different feature defaults, seed data, and nav visibility
// (see buildFeaturesV2 in lib/tiers.ts and provisionRestaurant in
// lib/provisioning.ts). business_type itself stays the single source of
// truth (editable at onboarding and in Settings) — mode is always derived
// from it, never stored separately, so the two can't drift out of sync.

export type BusinessMode = 'dine_in' | 'counter_service' | 'bar_service' | 'delivery_only'

export const ONBOARDING_BUSINESS_TYPES = [
    'FastFood', 'Fine Dining', 'Cafe', 'Bar', 'Cloud Kitchen', 'Resort/Hotel', 'Bakery', 'Restaurant',
] as const

// FUTURE EPIC: Resort/Hotel is temporarily mapped to 'dine_in' below because a
// proper hospitality mode requires net-new entities this codebase doesn't have:
//   - `rooms` and `reservations`/`bookings` (with date ranges, check-in/out) —
//     `sessions` today is a single dine-in visit with a hardcoded 4-hour expiry
//     and no multi-day concept; not reusable for a stay.
//   - A guest folio (running per-stay balance across multiple orders/services).
//   - `front_desk` / `housekeeping` staff roles — today's roles
//     (super_admin/manager/kitchen/waiter/cashier/customer) and the route rules
//     in src/proxy.ts / src/lib/roleLanding.ts are hardcoded per role name, so
//     this means new routes/pages, not a config toggle.
//   - A `room_service` order_type value alongside the existing
//     'dine_in' | 'takeout' | 'delivery' (src/types/database.ts), following the
//     pattern of place_delivery_order() in src/app/api/takeout/actions.ts.
// Until that epic ships, Resort/Hotel behaves identically to Full-Service
// Dine-In (the closest existing operational fit) — do not leave it unmapped.
export const BUSINESS_TYPE_TO_MODE: Record<string, BusinessMode> = {
    'Restaurant': 'dine_in',
    'Fine Dining': 'dine_in',
    'Resort/Hotel': 'dine_in',
    'Cafe': 'counter_service',
    'Bakery': 'counter_service',
    'FastFood': 'counter_service',
    'Bar': 'bar_service',
    'Cloud Kitchen': 'delivery_only',
}

export function getBusinessMode(businessType: string | null | undefined): BusinessMode {
    return (businessType && BUSINESS_TYPE_TO_MODE[businessType]) || 'dine_in'
}
