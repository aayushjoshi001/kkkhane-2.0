// Shared helpers for the in-room guest phone gate (see RoomGuestVerify +
// roomGuestActions). Kept in a plain module so both the server action and the
// server component page can share the cookie name and phone normalization.

export const ROOM_VERIFY_COOKIE_PREFIX = 'rmv_'

/** Verification is scoped to a stay: a new booking id means a fresh gate. */
export function roomVerifyCookieName(bookingId: string): string {
    return `${ROOM_VERIFY_COOKIE_PREFIX}${bookingId}`
}

/**
 * Last 10 digits, ignoring spaces / country code — the same normalization
 * lib/sms.ts uses, so a booking phone saved as "+977 98…" matches a guest who
 * types "98…".
 */
export function normalizeRoomPhone(phone: string | null | undefined): string {
    return (phone || '').replace(/\D/g, '').slice(-10)
}

export const ROOM_VERIFY_TTL_SECONDS = 60 * 60 * 24 // 24h
