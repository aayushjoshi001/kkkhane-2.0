// lib/roleLanding.ts
// Single source of truth for "which page does this role land on by default".
// Previously duplicated (and able to drift) across src/proxy.ts,
// src/app/login/page.tsx, and src/app/login/actions.ts.
export const ROLE_LANDING: Record<string, string> = {
    super_admin: '/admin/dashboard',
    manager: '/admin/dashboard',
    kitchen: '/kitchen',
    bartender: '/bar',
    waiter: '/waiter',
    cashier: '/cashier',
    onboarding: '/onboarding',
}
