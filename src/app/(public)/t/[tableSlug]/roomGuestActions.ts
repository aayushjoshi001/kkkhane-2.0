'use server'

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { getRoomContextForTable } from '@/lib/rooms'
import { roomVerifyCookieName, normalizeRoomPhone, ROOM_VERIFY_TTL_SECONDS } from '@/lib/roomGuest'
import { checkRateLimit, RATE_LIMIT_RULES } from '@/lib/ratelimit'

/**
 * Confirm the scanning guest is the person checked into this room by matching
 * the phone they enter against the booking's guest_phone. On success we set an
 * httpOnly cookie scoped to the booking, so the guest isn't re-prompted for the
 * rest of their stay (or until it rotates). This is identity confirmation, not
 * OTP — the physical in-room QR is the possession factor.
 */
export async function verifyRoomGuest(
    tableId: string,
    phone: string,
): Promise<{ success: true } | { error: string }> {
    // Cap attempts per IP so the booking phone can't be brute-forced through
    // repeated guesses. Fails open if Upstash isn't configured.
    const limited = await checkRateLimit(
        'ROOM_VERIFY',
        RATE_LIMIT_RULES.ROOM_VERIFY.requests,
        RATE_LIMIT_RULES.ROOM_VERIFY.windowSeconds,
    )
    if (limited) return { error: limited }

    const digits = normalizeRoomPhone(phone)
    if (digits.length < 10) {
        return { error: 'Enter the 10-digit mobile number on your booking.' }
    }

    const admin = await createAdminClient()
    const ctx = await getRoomContextForTable(admin, tableId)

    if (!ctx?.bookingId) {
        return { error: 'This room has no active check-in. Please contact reception.' }
    }
    if (!ctx.guestPhone) {
        return { error: 'No phone is on file for this stay. Please contact reception.' }
    }
    if (normalizeRoomPhone(ctx.guestPhone) !== digits) {
        return { error: "That number doesn't match the guest checked into this room." }
    }

    const store = await cookies()
    store.set(roomVerifyCookieName(ctx.bookingId), '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ROOM_VERIFY_TTL_SECONDS,
    })
    return { success: true }
}
