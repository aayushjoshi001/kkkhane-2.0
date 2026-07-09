// lib/pricing.ts
// Single source of truth for the *published* plans, shared by the marketing
// homepage and /pricing. The enforced caps live in lib/tiers.ts — every
// "Up to N" benefit below must match TIER_LIMITS for the same tier, or we are
// selling capacity the app will refuse to grant.
//
// `comingSoon` marks a benefit the product does not ship yet. It is rendered
// muted with a badge, never as an available feature. Drop the flag when the
// feature lands; do not add a bullet without one until it does.

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
          /** Undiscounted annual price. Struck through when it differs from firstYear. */
          list: number
          /** What a new customer pays for their first year. */
          firstYear: number
          /** Renewals bill at 50% of `list`. Absent means renewals bill at `list`. */
          renewsAtHalfList?: true
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
    {
        tier: 'free',
        name: 'Free',
        tagline: 'For individuals & starters looking to digitize their kitchen.',
        price: { kind: 'free' },
        cta: { label: 'Get Started', href: '/signup' },
        headline: {
            title: 'Included',
            items: [
                { label: 'Limited Dishes' },
                { label: 'Limited Categories' },
                { label: 'Limited Add-ons' },
                { label: 'Limited SubMenus', comingSoon: true },
                { label: 'Limited MenuSets', comingSoon: true },
            ],
        },
        benefits: [
            { label: 'Daybook' },
            { label: 'Limited income & expense tracking' },
        ],
        limitations: [
            { label: 'No reservation orders' },
            { label: 'No customer orders' },
            { label: 'Only 100 dishes' },
            { label: 'Only 10 categories' },
            { label: 'Only 5 add-ons' },
            { label: 'Only 3 submenus', comingSoon: true },
            { label: 'Only 1 menuset', comingSoon: true },
            { label: 'No sales & support' },
        ],
    },
    {
        tier: 'basic',
        name: 'Basic',
        tagline: 'Perfect for tracking order management.',
        price: { kind: 'yearly', list: 9_999, firstYear: 9_999 },
        cta: { label: 'Get Started', href: '/signup' },
        headline: {
            title: 'Basic Features',
            items: [
                { label: 'Ordering System' },
                { label: 'Digital Ordering Portal' },
            ],
        },
        benefits: [
            // Mirrors TIER_LIMITS.basic — 5 staff / 20 tables / 500 menu items.
            { label: 'Up to 5 users login' },
            { label: 'Up to 20 tables' },
            { label: 'Up to 500 dishes' },
            { label: 'Dine-in & delivery ordering' },
            { label: 'Digital QR menu ordering' },
            { label: 'KOT/BOT management' },
            { label: 'Up to 30 customer management' },
            { label: 'Full history of transactions' },
            { label: 'Limited income & expense tracking' },
        ],
    },
    {
        tier: 'premium',
        name: 'Premium',
        tagline: 'Perfect for growing restaurants looking to scale.',
        price: { kind: 'yearly', list: 30_000, firstYear: 22_000, renewsAtHalfList: true },
        cta: { label: 'Get Started', href: '/signup' },
        popular: true,
        headline: {
            title: 'Everything in Basic, plus',
            items: [
                { label: 'Inventory Management' },
                { label: 'Accounting System' },
                { label: 'CRM & Loyalty Points' },
            ],
        },
        benefits: [
            // Mirrors TIER_LIMITS.premium — 24 staff / 50 tables / 1000 menu items.
            { label: 'Up to 24 users login' },
            { label: 'Up to 50 tables' },
            { label: 'Up to 1000 dishes' },
            { label: 'Online delivery portal' },
            { label: 'Takeaway, pickup, reservation' },
            { label: 'Live sales & finance insights' },
            { label: 'Low stock alerts via email & notification' },
            { label: 'Up to 500 customer management' },
            { label: 'Full history of transactions' },
            { label: 'Daybook closing & email alert' },
            { label: 'Custom user roles' },
            { label: 'Chat and live call support' },
        ],
    },
    {
        tier: 'platinum',
        name: 'Platinum',
        tagline: 'For large teams with multi-kitchen departments and service.',
        price: { kind: 'yearly', list: 55_000, firstYear: 55_000, renewsAtHalfList: true },
        cta: { label: 'Get Started', href: '/signup' },
        headline: {
            title: 'Everything in Premium, plus',
            items: [
                { label: 'Custom Features' },
                { label: 'Multi-Outlet Management', comingSoon: true },
                { label: '24/7 Priority Support' },
            ],
        },
        benefits: [
            { label: 'Unlimited users login' },
            { label: 'Unlimited tables' },
            { label: 'Unlimited dishes' },
            { label: 'Advanced insights & reporting' },
            { label: 'Online ordering portal' },
            { label: 'Multi-location inventory', comingSoon: true },
            { label: 'Up to 1000 customer management' },
            { label: 'eBilling setup — no charge', comingSoon: true },
            { label: 'Custom domain & branding', comingSoon: true },
            { label: 'Unlimited activity logs' },
            { label: 'On-demand training' },
            { label: '24/7 priority support' },
        ],
    },
    {
        tier: 'enterprise',
        name: 'Enterprise',
        tagline: 'Built for large restaurants needing advanced tools.',
        price: { kind: 'contact' },
        cta: { label: "Let's Chat", href: '/contact' },
        headline: {
            title: 'Everything in Platinum, plus',
            items: [
                { label: 'Branded Mobile App & Website', comingSoon: true },
                { label: 'Dedicated Server & Database' },
                { label: 'Franchise Management', comingSoon: true },
            ],
        },
        benefits: [
            { label: 'No limitations in usage' },
            { label: 'Custom & branded ecosystem' },
            { label: 'Advanced API & webhook integrations', comingSoon: true },
            { label: 'Dedicated account manager' },
            { label: 'Consolidated payment gateways' },
            { label: 'SLA guarantee' },
            { label: 'On-demand training' },
            { label: '24/7 support' },
        ],
    },
]
