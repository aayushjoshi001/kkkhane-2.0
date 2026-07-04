// lib/staffPin.server.ts
// Server-only random-generation helpers for PIN-based staff login. Uses
// Node's `crypto` module — import only from 'use server' files, never from a
// 'use client' component (see lib/staffPin.ts for the client-safe constants).
import { randomInt, randomBytes } from 'crypto'

/** Cryptographically-random 4-digit PIN, zero-padded (e.g. "0042"). */
export function generateStaffPin(): string {
    return randomInt(0, 10000).toString().padStart(4, '0')
}

/**
 * Synthetic email for a PIN-only staff account — never used for real mail,
 * just satisfies Supabase Auth's requirement that every user have an email.
 * Uniqueness comes from the random suffix, not the name.
 */
export function generateStaffLoginEmail(): string {
    return `staff.${randomBytes(6).toString('hex')}@staff.kkkhane.internal`
}

/** Discarded immediately after createUser() — the real gate is pin_hash, verified via RPC. */
export function generateDiscardPassword(): string {
    return randomBytes(24).toString('hex')
}
