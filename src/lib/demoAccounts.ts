// lib/demoAccounts.ts
// Single source of truth for the built-in demo accounts surfaced on the login
// screen. Kept free of server-only imports so it can be pulled into the client
// bundle (LoginForm renders the button list from DEMO_ACCOUNTS) while the login
// server action uses the same list to self-heal / provision the accounts.
//
// There are two demo tenants: a counter-service Restaurant and a Resort/Hotel.
// Each has its own owner + staff accounts; the hotel additionally gets rooms,
// room types, bookings and room-numbered dining tables seeded so the full
// check-in → in-room order → checkout flow is demoable out of the box.

export const DEMO_PASSWORD = 'Password123!'

/** Which demo restaurant an account belongs to. */
export type DemoTenant = 'restaurant' | 'hotel'

export interface DemoAccount {
    email: string
    label: string
    fullName: string
    /** public.roles.id for this account, or null for the onboarding-only demo. */
    roleId: number | null
    /** Which demo tenant this account signs into. */
    tenant: DemoTenant
    /** Owns the tenant's demo restaurant. Exactly one account per tenant sets this. */
    isOwner?: boolean
    /** Tailwind classes for the login-screen chip. */
    color: string
}

// role ids come from public.roles: 1=super_admin 2=manager 3=kitchen
// 4=waiter 5=customer 6=cashier (see supabase/seed.sql).
export const DEMO_ACCOUNTS: DemoAccount[] = [
    // ── Restaurant (counter-service) ─────────────────────────────────────────
    { email: 'newuser@srms.app', label: 'New User',    fullName: 'New Onboarding User', roleId: null,             tenant: 'restaurant', color: 'bg-pink-100 text-pink-700 hover:bg-pink-200' },
    { email: 'demo@srms.app',    label: 'Super Admin', fullName: 'Demo Super Admin',    roleId: 1, isOwner: true, tenant: 'restaurant', color: 'bg-brand-100 text-orange-700 hover:bg-brand-200' },
    { email: 'manager@srms.app', label: 'Manager',     fullName: 'Demo Manager',        roleId: 2,                tenant: 'restaurant', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
    { email: 'kitchen@srms.app', label: 'Kitchen',     fullName: 'Demo Kitchen',        roleId: 3,                tenant: 'restaurant', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
    { email: 'waiter@srms.app',  label: 'Waiter',      fullName: 'Demo Waiter',         roleId: 4,                tenant: 'restaurant', color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
    { email: 'cashier@srms.app', label: 'Cashier',     fullName: 'Demo Cashier',        roleId: 6,                tenant: 'restaurant', color: 'bg-teal-100 text-teal-700 hover:bg-teal-200' },

    // ── Hotel (Resort/Hotel) ─────────────────────────────────────────────────
    { email: 'hotel@srms.app',       label: 'Hotel Admin',  fullName: 'Demo Hotel Admin',   roleId: 1, isOwner: true, tenant: 'hotel', color: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' },
    { email: 'frontdesk@srms.app',   label: 'Front Desk',   fullName: 'Demo Front Desk',    roleId: 6,                tenant: 'hotel', color: 'bg-sky-100 text-sky-700 hover:bg-sky-200' },
    { email: 'hotelkitchen@srms.app',label: 'Hotel Kitchen',fullName: 'Demo Hotel Kitchen', roleId: 3,                tenant: 'hotel', color: 'bg-amber-100 text-amber-700 hover:bg-amber-200' },
    { email: 'roomservice@srms.app', label: 'Room Service', fullName: 'Demo Room Service',  roleId: 4,                tenant: 'hotel', color: 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200' },
]

/** The demo restaurant every restaurant-tenant staff account belongs to. */
export const DEMO_RESTAURANT = {
    name: 'Demo Restaurant',
    slug: 'demo-restaurant',
    businessType: 'FastFood',
} as const

/** The demo hotel every hotel-tenant staff account belongs to. */
export const DEMO_HOTEL = {
    name: 'Demo Grand Hotel',
    slug: 'demo-grand-hotel',
    businessType: 'Resort/Hotel',
} as const

export const DEMO_TENANTS: Record<DemoTenant, { name: string; slug: string; businessType: string }> = {
    restaurant: DEMO_RESTAURANT,
    hotel: DEMO_HOTEL,
}

/** Display grouping for the login screen, in render order. */
export const DEMO_GROUPS: { tenant: DemoTenant; title: string }[] = [
    { tenant: 'restaurant', title: 'Restaurant' },
    { tenant: 'hotel', title: 'Hotel' },
]

export function findDemoAccount(email: string): DemoAccount | undefined {
    const normalized = email.trim().toLowerCase()
    return DEMO_ACCOUNTS.find(a => a.email === normalized)
}
