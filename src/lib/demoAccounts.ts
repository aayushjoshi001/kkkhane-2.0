// lib/demoAccounts.ts
// Single source of truth for the built-in demo accounts surfaced on the login
// screen. Kept free of server-only imports so it can be pulled into the client
// bundle (LoginForm renders the button list from DEMO_ACCOUNTS) while the login
// server action uses the same list to self-heal / provision the accounts.

export const DEMO_PASSWORD = 'Password123!'

export interface DemoAccount {
    email: string
    label: string
    fullName: string
    /** public.roles.id for this account, or null for the onboarding-only demo. */
    roleId: number | null
    /** Owns the shared demo restaurant. Exactly one account sets this. */
    isOwner?: boolean
    /** Tailwind classes for the login-screen chip. */
    color: string
}

// role ids come from public.roles: 1=super_admin 2=manager 3=kitchen
// 4=waiter 5=customer 6=cashier (see supabase/seed.sql).
export const DEMO_ACCOUNTS: DemoAccount[] = [
    { email: 'newuser@srms.app', label: 'New User',    fullName: 'New Onboarding User', roleId: null,             color: 'bg-pink-100 text-pink-700 hover:bg-pink-200' },
    { email: 'demo@srms.app',    label: 'Super Admin', fullName: 'Demo Super Admin',    roleId: 1, isOwner: true, color: 'bg-brand-100 text-orange-700 hover:bg-brand-200' },
    { email: 'manager@srms.app', label: 'Manager',     fullName: 'Demo Manager',        roleId: 2,                color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
    { email: 'kitchen@srms.app', label: 'Kitchen',     fullName: 'Demo Kitchen',        roleId: 3,                color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
    { email: 'waiter@srms.app',  label: 'Waiter',      fullName: 'Demo Waiter',         roleId: 4,                color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
    { email: 'cashier@srms.app', label: 'Cashier',     fullName: 'Demo Cashier',        roleId: 6,                color: 'bg-teal-100 text-teal-700 hover:bg-teal-200' },
]

/** The shared restaurant all staff demo accounts belong to. */
export const DEMO_RESTAURANT = {
    name: 'Demo Restaurant',
    slug: 'demo-restaurant',
    businessType: 'FastFood',
} as const

export function findDemoAccount(email: string): DemoAccount | undefined {
    const normalized = email.trim().toLowerCase()
    return DEMO_ACCOUNTS.find(a => a.email === normalized)
}
