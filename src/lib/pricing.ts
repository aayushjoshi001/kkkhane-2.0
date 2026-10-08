// lib/pricing.ts
// Single source of truth for published plans. Shared by the marketing homepage
// and /pricing. The enforced caps live in lib/tiers.ts — every "Up to N"
// benefit below must match TIER_LIMITS for the same tier, or we are selling
// capacity the app will refuse to grant.
//
// Design rationale (Nepal market, Oct 2026):
//   Free   — lead magnet for dhabas / kiosks; deliberately tight so IRD
//             invoicing and Nepal Pay are the upgrade hook into Basic.
//   Basic  — primary Nepal SME tier; beats Hamrobill (Rs. 8-15k/yr) on
//             features while staying accessible to small restaurants.
//   Premium — targets growing restaurants now on Petpooja Nepal (~Rs. 18-30k);
//             inventory + loyalty justify the step up.
//   Platinum — hotel + restaurant integrated; no direct local competitor.
//   Enterprise — chains, franchises, branded apps.
//
// Infrastructure note: Supabase Pro ($25/mo) + Vercel Pro ($20/mo) + Redis
// comfortably handles 500 customers/day per restaurant across 100 tenants
// (~4 req/s average, ~50 req/s peak). Connection pooler (PgBouncer) is on
// by default. Menu reads hit Redis first; the DB sees mostly writes. The
// break-even point is ~20 paying Basic restaurants; margin reaches 85%+ at 50.
//
// `comingSoon` marks a benefit the product does not ship yet. Rendered muted
// with a badge, never as an available feature. Drop the flag when it lands.

import type { Tier } from '@/lib/tiers'

export const CURRENCY_SYMBOL = 'Rs.'

/** Nepali digit grouping matches en-IN (2,00,000), not en-US. */
export const formatPrice = (amount: number): string =>
    new Intl.NumberFormat('en-IN').format(amount)

export type PlanPrice =
    | { kind: 'free' }
    | { kind: 'contact' }
    | {
          kind: 'yearly'
          /** Undiscounted annual list price. Struck through when it differs from firstYear. */
          list: number
          /** What a new customer pays for their first year. */
          firstYear: number
          /** When true, renewals bill at 50% of `list`. Absent = renewals at `list`. */
          renewsAtHalfList?: true
          /** Monthly billing option. ~30-35% above annual to reward annual commitment. */
          monthly?: number
      }

/** What this plan costs on renewal, or null when the question doesn't apply. */
export function renewalPrice(price: PlanPrice): number | null {
    if (price.kind !== 'yearly') return null
    return price.renewsAtHalfList ? price.list / 2 : price.list
}

export type Benefit = {
    label: string
    /** Not built yet — rendered muted with a "Coming soon" badge. */
    comingSoon?: true
}

export type Plan = {
    tier: Tier
    name: string
    tagline: string
    price: PlanPrice
    cta: { label: string; href: string }
    popular?: true
    /** The "Everything in X, plus" headline capabilities. */
    headline: { title: string; items: Benefit[] }
    benefits: Benefit[]
    /** Free only: what you explicitly do not get. */
    limitations?: Benefit[]
}

export const PLANS: Plan[] = [
    // ─── FREE ──────────────────────────────────────────────────────────────────
    // Target: dhabas, kiosks, food stalls, trial users.
    // Key conversion hook: hitting dish/table cap, or needing IRD invoice / Nepal Pay.
    {
        tier: 'free',
        name: 'Free',
        tagline: 'Try KKKhane with no commitment — for small food stalls and kiosks.',
        price: { kind: 'free' },
        cta: { label: 'Start for Free', href: '/signup' },
        headline: {
            title: 'What you get',
            items: [
                { label: 'Up to 50 dishes & 5 tables' },
                { label: 'Up to 2 staff accounts' },
                { label: 'QR menu & dine-in ordering' },
                { label: 'KOT printing (Kitchen Order Ticket)' },
            ],
        },
        benefits: [
            { label: 'QR table menu & ordering' },
            { label: 'Live KOT / BOT printing' },
            { label: 'Basic cash receipt' },
            { label: 'Order history' },
            { label: 'Kitchen Display System (KDS)' },
        ],
        limitations: [
            { label: 'No IRD-compliant VAT/PAN invoice' },
            { label: 'No Nepal Pay — eSewa, Khalti, Fonepay' },
            { label: 'No Day Book / Cash Book / Bank Book' },
            { label: 'No takeout or delivery ordering' },
            { label: 'No staff attendance or salary' },
            { label: 'No inventory or ingredient tracking' },
            { label: 'No loyalty or CRM' },
            { label: 'No dedicated support' },
        ],
    },

    // ─── BASIC ─────────────────────────────────────────────────────────────────
    // Target: small restaurants, cafes, bakeries currently on Hamrobill / local POS.
    // Price anchor: Hamrobill Basic = Rs. 8-12k/yr with no QR, no realtime KDS.
    // At 100 customers/day: ~1,100 DB rows/day, ~800 API calls/day.
    // Infra cost per restaurant at 50 tenants: ~Rs. 160/mo. Revenue: Rs. 833/mo.
    {
        tier: 'basic',
        name: 'Basic',
        tagline: 'For small restaurants ready for proper billing, accounting & digital payments.',
        price: {
            kind: 'yearly',
            list: 9_999,
            firstYear: 9_999,
            // Rs. 9,999/yr ÷ 12 = Rs. 833/mo annual rate.
            // Monthly at Rs. 1,099 is a 32% premium — rewards annual commitment.
            monthly: 1_099,
        },
        cta: { label: 'Get Started', href: '/signup' },
        headline: {
            title: 'Everything in Free, plus',
            items: [
                { label: 'IRD-compliant VAT / PAN invoice' },
                { label: 'Nepal Pay — eSewa, Khalti, Fonepay' },
                { label: 'Day Book, Cash Book & Bank Book' },
            ],
        },
        benefits: [
            // Mirrors TIER_LIMITS.basic — 5 staff / 20 tables / 500 menu items.
            { label: 'Up to 5 staff accounts' },
            { label: 'Up to 20 tables' },
            { label: 'Up to 500 dishes & modifiers' },
            { label: 'IRD-compliant VAT / PAN invoice — sequential & tamper-evident' },
            { label: 'Nepal Pay — eSewa, Khalti, Fonepay & cash' },
            { label: 'Day Book — daily sales summary (Rojnamcha)' },
            { label: 'Cash Book — cash-in / cash-out ledger' },
            { label: 'Bank Book — bank transaction ledger' },
            { label: 'Income & expense recording' },
            { label: 'Takeout & delivery ordering (QR)' },
            { label: 'Staff attendance tracking' },
            { label: 'Full order & transaction history' },
            { label: 'Basic promotions & discounts' },
            { label: 'Email notifications' },
            { label: 'Email support (72 hr response)' },
        ],
    },

    // ─── PREMIUM ───────────────────────────────────────────────────────────────
    // Target: growing restaurants, cloud kitchens, fast food chains currently on
    // Petpooja Nepal (Rs. 18-30k/yr) or wanting inventory + loyalty.
    // First-year offer creates urgency; 50% renewal rewards retention.
    // At 300 customers/day: ~3,300 DB rows/day, ~2,400 API calls/day — fine on Pro.
    {
        tier: 'premium',
        name: 'Premium',
        tagline: 'For growing restaurants that need inventory, loyalty and full financial control.',
        price: {
            kind: 'yearly',
            list: 34_999,
            firstYear: 24_999,
            renewsAtHalfList: true,
            // Rs. 24,999/yr ÷ 12 = Rs. 2,083/mo annual rate.
            // Monthly at Rs. 2,699 is a 30% premium.
            monthly: 2_699,
        },
        cta: { label: 'Get Started', href: '/signup' },
        popular: true,
        headline: {
            title: 'Everything in Basic, plus',
            items: [
                { label: 'Inventory & ingredient tracking' },
                { label: 'Loyalty program & customer CRM' },
                { label: 'Staff shifts, salary & custom roles' },
            ],
        },
        benefits: [
            // Mirrors TIER_LIMITS.premium — 20 staff / 50 tables / 1,000 menu items.
            { label: 'Up to 20 staff accounts' },
            { label: 'Up to 50 tables' },
            { label: 'Up to 1,000 dishes & modifiers' },
            { label: 'Inventory & ingredient tracking with low-stock alerts' },
            { label: 'Loyalty points, 4 membership tiers & customer CRM' },
            { label: 'Dynamic pricing — peak hours, seasons, events' },
            { label: 'Staff shifts, salary & salary history' },
            { label: 'Custom staff roles & fine-grained permissions' },
            { label: 'EOD Z-reports & Day Book closing alerts' },
            { label: 'Supplier management & purchase vouchers' },
            { label: 'Live sales dashboard & advanced finance reports' },
            { label: 'Advance reservation & takeout / pickup queue' },
            { label: '2-location support (same brand)' },
            { label: 'WhatsApp order & EOD shift reports' },
            { label: 'Chat support (24 hr response)' },
        ],
    },

    // ─── PLATINUM ──────────────────────────────────────────────────────────────
    // Target: hotels, resorts, large restaurants & multi-department operations.
    // No direct Nepali competitor for integrated hotel + restaurant PMS/POS.
    // At 500 customers/day: Supabase Pro + Small compute ($10 add-on) handles it.
    {
        tier: 'platinum',
        name: 'Platinum',
        tagline: 'For hotels, resorts & large restaurants that need an integrated system.',
        price: {
            kind: 'yearly',
            list: 59_999,
            firstYear: 49_999,
            renewsAtHalfList: true,
            // Rs. 49,999/yr ÷ 12 = Rs. 4,167/mo annual rate.
            // Monthly at Rs. 5,499 is a 32% premium.
            monthly: 5_499,
        },
        cta: { label: 'Get Started', href: '/signup' },
        headline: {
            title: 'Everything in Premium, plus',
            items: [
                { label: 'Hotel — rooms, bookings, check-in/out & folio' },
                { label: 'Unlimited staff, tables, dishes & rooms' },
                { label: 'Multi-location & Bikram Sambat support' },
            ],
        },
        benefits: [
            // TIER_LIMITS.platinum is UNLIMITED across the board.
            { label: 'Unlimited staff accounts' },
            { label: 'Unlimited tables, rooms & dishes' },
            { label: 'Hotel management — room bookings, check-in/out & folio billing' },
            { label: 'Integrated hotel + restaurant billing on one bill' },
            { label: 'Multi-location — unlimited branches' },
            { label: 'Bikram Sambat (BS) date support throughout' },
            { label: 'Nepali language menu & interface', comingSoon: true },
            { label: 'Online ordering portal (your own link)' },
            { label: 'Advanced analytics & custom exportable reports' },
            { label: 'Unlimited audit & activity logs' },
            { label: 'IRD eBilling sync', comingSoon: true },
            { label: 'Multi-location inventory consolidation', comingSoon: true },
            { label: 'On-demand staff training sessions' },
            { label: '24/7 priority phone & chat support' },
        ],
    },

    // ─── ENTERPRISE ────────────────────────────────────────────────────────────
    // Target: hotel chains, restaurant franchises, large food groups.
    // Contact-only: pricing is customised to outlet count, SLA & integrations needed.
    {
        tier: 'enterprise',
        name: 'Enterprise',
        tagline: 'Custom solution for hotel chains, restaurant franchises & large groups.',
        price: { kind: 'contact' },
        cta: { label: "Let's Talk", href: '/contact' },
        headline: {
            title: 'Everything in Platinum, plus',
            items: [
                { label: 'Branded mobile app & portal', comingSoon: true },
                { label: 'Dedicated server & isolated database' },
                { label: 'Franchise & central-outlet management', comingSoon: true },
            ],
        },
        benefits: [
            { label: 'No usage limits' },
            { label: 'Dedicated cloud server & isolated database' },
            { label: 'Branded app, portal & custom domain', comingSoon: true },
            { label: 'Advanced API & webhook integrations', comingSoon: true },
            { label: 'Franchise management & consolidated reporting', comingSoon: true },
            { label: 'Consolidated payment gateway setup' },
            { label: 'Dedicated account manager' },
            { label: 'Uptime SLA guarantee' },
            { label: 'On-site training & onboarding' },
            { label: '24/7 dedicated phone, chat & WhatsApp support' },
        ],
    },
]
