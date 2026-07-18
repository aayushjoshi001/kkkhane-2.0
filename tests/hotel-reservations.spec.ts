import { test, expect, type Page } from '@playwright/test'
import { DEMO_PASSWORD } from '../src/lib/demoAccounts'

/**
 * A booking whose check-in is in the future must reserve the room without
 * occupying it today, and must not stop other guests using the room on the
 * nights before the reserved guest arrives.
 *
 * This is the rule the front desk depends on: before it existed, every booking
 * was written straight to 'checked_in' and flipped the room to 'occupied' the
 * moment it was created, so booking room 101 for next Friday made 101
 * unsellable for the whole week and marked a guest who wasn't there as resident.
 */

// Room numbers are unique per restaurant, and the demo hotel is re-provisioned
// rather than reset, so a fixed number would collide on the second run.
const stamp = Date.now().toString().slice(-7)
const ROOM_RESERVED = `E2E-R${stamp}`
const ROOM_WALKIN = `E2E-W${stamp}`

const dayFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

async function loginAsHotelAdmin(page: Page) {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('hotel@srms.app')
    await page.getByLabel(/password/i).fill(DEMO_PASSWORD)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    // The demo account is provisioned by loginAction on first sign-in, which
    // seeds the whole hotel tenant — slow, hence the generous wait.
    await page.waitForURL(/\/admin/, { timeout: 90_000 })
}

test.describe('hotel reservations', () => {
    test('future stays reserve, walk-ins occupy, and overlaps are refused', async ({ page }) => {
        await loginAsHotelAdmin(page)

        // --- fixtures: our own room type + two rooms, isolated from demo data
        const typeRes = await page.request.post('/api/rooms/types', {
            data: { name: `E2E Type ${stamp}`, base_price: 2000, capacity: 2 },
        })
        expect(typeRes.ok(), await typeRes.text()).toBeTruthy()
        const typeId = (await typeRes.json()).data.id

        const mkRoom = async (room_number: string) => {
            const res = await page.request.post('/api/rooms', {
                data: { room_number, floor: '9', type_id: typeId },
            })
            expect(res.ok(), await res.text()).toBeTruthy()
            return (await res.json()).data.id as string
        }
        const reservedRoomId = await mkRoom(ROOM_RESERVED)
        const walkInRoomId = await mkRoom(ROOM_WALKIN)

        const book = (data: Record<string, unknown>) =>
            page.request.post('/api/bookings', {
                data: { guest_phone: '9800000000', guest_count: 2, ...data },
            })

        // --- 1. A stay starting next week is a reservation, not a check-in.
        const reservation = await book({
            room_id: reservedRoomId,
            guest_name: 'Future Guest',
            check_in: dayFromNow(7),
            check_out: dayFromNow(9),
        })
        expect(reservation.ok(), await reservation.text()).toBeTruthy()
        expect((await reservation.json()).data.status).toBe('pending')

        // --- 2. It must not have occupied the room. The room is still sellable
        // tonight, which is the entire point of separating pending from checked_in.
        const statusRes = await page.request.post('/api/rooms/status', {
            data: { roomId: reservedRoomId, status: 'available' },
        })
        expect(statusRes.ok(), await statusRes.text()).toBeTruthy()

        // --- 3. A second stay overlapping those dates is refused.
        const overlapping = await book({
            room_id: reservedRoomId,
            guest_name: 'Clashing Guest',
            check_in: dayFromNow(8),
            check_out: dayFromNow(10),
        })
        expect(overlapping.status()).toBe(409)
        expect((await overlapping.json()).error).toMatch(/reserved|different dates/i)

        // --- 4. Back-to-back is fine: check-out day and check-in day may be the
        // same date, because the ranges are half-open.
        const backToBack = await book({
            room_id: reservedRoomId,
            guest_name: 'Next Guest',
            check_in: dayFromNow(9),
            check_out: dayFromNow(11),
        })
        expect(backToBack.ok(), await backToBack.text()).toBeTruthy()
        expect((await backToBack.json()).data.status).toBe('pending')

        // --- 5. A guest standing at the desk right now still checks straight in.
        const walkIn = await book({
            room_id: walkInRoomId,
            guest_name: 'Walk In Guest',
            check_in: new Date().toISOString(),
            check_out: dayFromNow(2),
        })
        expect(walkIn.ok(), await walkIn.text()).toBeTruthy()
        expect((await walkIn.json()).data.status).toBe('checked_in')

        // ...and that one DID occupy the room, so marking it available is refused.
        const occupied = await page.request.post('/api/rooms/status', {
            data: { roomId: walkInRoomId, status: 'available' },
        })
        expect(occupied.status()).toBe(409)
        expect((await occupied.json()).error).toMatch(/still checked in/i)
    })

    test('checking a reserved guest in is refused while the room is still occupied', async ({ page }) => {
        await loginAsHotelAdmin(page)

        const typeRes = await page.request.post('/api/rooms/types', {
            data: { name: `E2E Late ${stamp}`, base_price: 2000, capacity: 2 },
        })
        const typeId = (await typeRes.json()).data.id
        const roomRes = await page.request.post('/api/rooms', {
            data: { room_number: `E2E-L${stamp}`, floor: '9', type_id: typeId },
        })
        const roomId = (await roomRes.json()).data.id

        // Current guest is in the room and leaves tomorrow.
        const current = await page.request.post('/api/bookings', {
            data: {
                room_id: roomId, guest_name: 'Lingering Guest', guest_phone: '9800000001',
                guest_count: 2, check_in: new Date().toISOString(), check_out: dayFromNow(1),
            },
        })
        expect(current.ok(), await current.text()).toBeTruthy()

        // Tomorrow's guest reserves from the day the current one leaves. The
        // exclusion constraint permits this — the ranges don't overlap.
        const next = await page.request.post('/api/bookings', {
            data: {
                room_id: roomId, guest_name: 'Tomorrow Guest', guest_phone: '9800000002',
                guest_count: 2, check_in: dayFromNow(1), check_out: dayFromNow(3),
            },
        })
        expect(next.ok(), await next.text()).toBeTruthy()
        const nextId = (await next.json()).data.id

        // But they cannot physically check in while the previous guest is still
        // in the room. Dates alone can't catch this, so the API must.
        const earlyCheckIn = await page.request.post('/api/bookings/status', {
            data: { bookingId: nextId, status: 'checked_in' },
        })
        expect(earlyCheckIn.status()).toBe(409)
        expect((await earlyCheckIn.json()).error).toMatch(/still checked into this room/i)
    })

    test('an unknown booking status is rejected as a bad request', async ({ page }) => {
        await loginAsHotelAdmin(page)
        const res = await page.request.post('/api/bookings/status', {
            data: { bookingId: '00000000-0000-0000-0000-000000000000', status: 'teleported' },
        })
        expect(res.status()).toBe(400)
        expect((await res.json()).error).toMatch(/invalid status/i)
    })
})
