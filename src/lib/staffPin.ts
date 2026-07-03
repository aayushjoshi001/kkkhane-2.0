// lib/staffPin.ts
// Pure constants/helpers for PIN-based staff login — safe to import from
// client components (no Node built-ins). Random-generation helpers that need
// `crypto` live in lib/staffPin.server.ts and must only be imported from
// server-only files ('use server' actions), never from a 'use client' file.

// Only these three roles are ever eligible for PIN login — managers/super
// admins/customers always use email+password, even if a pin_hash somehow
// existed on their row.
export const PIN_ELIGIBLE_ROLE_IDS = [3, 4, 6] as const // kitchen, waiter, cashier

export function isPinEligibleRole(roleId: number): boolean {
    return (PIN_ELIGIBLE_ROLE_IDS as readonly number[]).includes(roleId)
}
