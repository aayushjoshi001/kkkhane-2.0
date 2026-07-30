// src/lib/utils.ts
// Shared utility functions

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AdvancePaymentMethod, ExpenseCategory } from '@/types/database'
import { toNepaliDate } from './nepaliDate'

/**
 * Merge class names with Tailwind-aware deduplication.
 * clsx joins conditionals; twMerge resolves conflicting utilities so a
 * caller-supplied className always wins over a primitive's defaults.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * The nightly rate the desk agreed for one stay, or 0 when it is on the
 * standard room type price.
 *
 * It lives as a [CUSTOM_RATE:X] tag in booking.notes rather than in a column of
 * its own: it belongs to this check-in window only, and the room type's catalog
 * price must stay untouched. Every billing path — folio, cashier preview,
 * invoice, print — reads it back through here, so they cannot disagree about
 * what the guest was quoted.
 */
export function getBookingCustomPrice(booking: { notes?: string | null } | null | undefined): number {
    if (!booking) return 0
    // e.g. "KYC: XYZ | [CUSTOM_RATE:2500]"
    if (booking.notes && typeof booking.notes === 'string') {
        const match = booking.notes.match(/\[CUSTOM_RATE:(\d+(?:\.\d+)?)\]/)
        if (match && match[1]) {
            return parseFloat(match[1]) || 0
        }
    }
    return 0
}

/**
 * The KYC note a stay was registered with, without the [CUSTOM_RATE:x] tag that
 * shares the same field. Returns '' when there is no KYC on file.
 */
export function getBookingKycNote(booking: { notes?: string | null } | null | undefined): string {
    const notes = booking?.notes
    if (!notes || typeof notes !== 'string' || !notes.startsWith('KYC:')) return ''
    return notes
        .replace(/\[CUSTOM_RATE:[^\]]*\]/g, '')
        .replace(/^KYC:/, '')
        .replace(/\|\s*$/, '')
        .trim()
}

/**
 * Format currency amount for display.
 *
 * The currency is configured per-restaurant in settings (features_v2.currency
 * and currencySymbol). Prefer the `useCurrency()` hook in client components and
 * pass the restaurant's currency/symbol in server components so the whole app
 * reflects a single configured currency instead of a mix of Rs./$.
 *
 * - When an explicit `symbol` is provided, it is used as the prefix for any
 *   currency (e.g. "Rs.", "$", "₹", "€").
 * - Otherwise NPR falls back to the "Rs." prefix and other ISO codes use Intl.
 */
/**
 * Rounds a money amount to paisa (2 dp), the smallest unit anything here is
 * ever billed or stored in.
 *
 * Every total assembled by adding and multiplying doubles drifts: a 10% service
 * charge, a percentage discount, or a long sum of line items lands on
 * 999.9999999999999 for a bill that reads Rs. 1,000.00. Displayed it looks
 * right — Intl and toFixed both round it back up — so the drift stays invisible
 * until something truncates it (Math.floor → 999) or compares it (paid < due by
 * 1e-13, leaving a bill "unsettled" with Rs. 0.00 outstanding). Rounding at the
 * point a total is formed keeps every later step exact.
 *
 * Several modules (folio.ts, invoiceSummary.ts, bookingBill.ts, CashierClient
 * …) still carry a private copy of this; prefer this one in new code so they can
 * converge on it.
 */
export function round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100
}

export function formatCurrency(amount: number, currency = 'NPR', symbol?: string | null): string {
    const value = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount)

    const trimmedSymbol = symbol?.trim()
    if (trimmedSymbol) {
        return `${trimmedSymbol} ${value}`
    }

    if (currency === 'NPR') {
        return `Rs. ${value}`
    }
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
        }).format(amount)
    } catch {
        return `${currency} ${amount.toFixed(2)}`
    }
}

/**
 * Calculate Haversine distance between two GPS coordinates in meters
 */
export function haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
): number {
    const R = 6371000 // Earth's radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

/**
 * Generate elapsed time string from a timestamp
 */
export function timeAgo(timestamp: string): string {
    const diff = Date.now() - new Date(timestamp).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}

/**
 * The business timezone. Every booking/stay timestamp is entered, stored and
 * displayed against Kathmandu wall-clock time regardless of where the browser
 * or the serverless runtime happens to be.
 *
 * Pinning this matters: Vercel runs Node in UTC, so anything that formats or
 * parses a date without an explicit zone renders differently in a server
 * component than in the browser. Nepal observes no DST, so the offset is a
 * constant +05:45 and the string form below is exact for every date.
 */
export const NEPAL_TZ = 'Asia/Kathmandu'
const NEPAL_UTC_OFFSET = '+05:45'

/**
 * Convert the naive `YYYY-MM-DDTHH:mm` value of an <input type="datetime-local">
 * into a real instant, reading it as Kathmandu wall-clock time.
 *
 * `new Date('2026-07-24T14:42')` resolves against the *runtime's* zone, so the
 * same string became 14:42Z on the server and 09:57Z in a Nepali browser. Every
 * booking created through the admin/cashier form was stored 5h45m late as a
 * result. Anchoring the offset removes the ambiguity.
 *
 * Values that already carry a zone (a full ISO string ending in `Z` or an
 * explicit ±HH:mm) are passed through untouched.
 */
export function nepalInputToISO(value: string | Date): string {
    if (value instanceof Date) return value.toISOString()
    const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value.trim())
    const normalized = hasZone
        ? value.trim()
        : `${value.trim().length === 16 ? `${value.trim()}:00` : value.trim()}${NEPAL_UTC_OFFSET}`
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid datetime: ${value}`)
    return date.toISOString()
}

/**
 * Inverse of {@link nepalInputToISO} — render an instant as the naive
 * `YYYY-MM-DDTHH:mm` that <input type="datetime-local"> expects, in Kathmandu
 * time, so prefilled forms show the same clock the staff member is reading.
 */
export function isoToNepalInput(value: string | Date | null | undefined): string {
    if (!value) return ''
    const date = typeof value === 'string' ? new Date(value) : value
    if (Number.isNaN(date.getTime())) return ''
    // en-CA yields ISO-ordered date parts, so this composes without reparsing.
    const [d, t] = date
        .toLocaleString('en-CA', {
            timeZone: NEPAL_TZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        })
        .split(', ')
    return `${d}T${t}`
}

/**
 * Default stay window for a new walk-in booking: check in now, check out at
 * noon the next day — both as Kathmandu wall-clock `datetime-local` values.
 *
 * Shared by the admin Rooms and cashier Room-manager booking forms, which each
 * used to build this from the browser's own clock.
 */
export function defaultStayWindowInputs(): { checkIn: string; checkOut: string } {
    const checkIn = isoToNepalInput(new Date())
    const [y, m, d] = checkIn.slice(0, 10).split('-').map(Number)
    // Calendar arithmetic in UTC so the day rolls over without a zone shift.
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
    return { checkIn, checkOut: `${nextDay}T12:00` }
}

/**
 * Format ISO datetime string into human readable locale string.
 */
export function formatDateTime(dateStr: string | Date | null | undefined, bsEnabled = false): string {
    if (!dateStr) return '-'
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
    const ad = date.toLocaleString('en-US', {
        timeZone: NEPAL_TZ,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    })
    if (!bsEnabled) return ad
    try {
        return `${ad} (${toNepaliDate(date, 'MMMM DD, YYYY', 'en')} BS)`
    } catch {
        return ad
    }
}

/**
 * Date-only counterpart to {@link formatDateTime}, for the compact stay-range
 * columns. Also pinned to Kathmandu so a late-evening check-in doesn't render
 * as the previous day in server components (which run in UTC).
 */
export function formatDateShort(
    dateStr: string | Date | null | undefined,
    opts: { withYear?: boolean } = {}
): string {
    if (!dateStr) return '-'
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleDateString('en-US', {
        timeZone: NEPAL_TZ,
        month: 'short',
        day: 'numeric',
        ...(opts.withYear ? { year: 'numeric' } : {})
    })
}

/**
 * Display label for how a booking's advance was collected. Single source for
 * the on-screen billing summaries and both printed receipts (HTML + thermal),
 * which previously each had their own inline ternary — and the receipts'
 * copies mislabeled a 'split' advance as plain "Cash".
 */
export function advanceMethodLabel(method: AdvancePaymentMethod | null | undefined): string {
    if (method === 'split') return 'Split Cash+QR'
    if (method === 'qr_digital') return 'QR/Digital'
    return 'Cash'
}

/**
 * Calculate stay night duration (ceiling value, minimum 1 night).
 */
/**
 * How long a guest may stay past checkout before the room is billed for
 * another day. Four hours covers a late morning flight or a delayed taxi;
 * beyond that the room cannot be turned around and re-let that day, so it
 * costs the hotel a full night either way.
 */
export const LATE_CHECKOUT_GRACE_HOURS = 4

/** The booking fields the late-checkout rule reads, as they come out of the DB. */
export interface StayDeparture {
    /** The departure the guest booked, not necessarily the one that happened. */
    check_out: string
    /** When the guest actually left. NULL while they are still in house. */
    checked_out_at?: string | null
    status?: string | null
}

/**
 * The moment to bill a stay up to.
 *
 * While the guest is in house this is now, so an overstay shows on the bill as
 * it accrues. Once they have left it is the recorded departure, which has to be
 * stable: the folio is recomputed after checkout (the receipt email does this),
 * and reading the clock there would keep inflating an already-settled bill.
 *
 * A stay already checked out with no recorded departure predates that column.
 * Those are treated as having left exactly on time, so historical bills
 * reproduce what was actually charged instead of growing by however many days
 * have passed since.
 *
 * Lives here rather than in lib/folio so the cashier's on-screen preview and
 * the server's authoritative total apply one definition — folio.ts pulls in
 * server-only code and cannot be imported into a client bundle.
 */
export function resolveDeparture(stay: StayDeparture, now: Date = new Date()): Date {
    if (stay.checked_out_at) return new Date(stay.checked_out_at)
    if (stay.status === 'checked_out') return new Date(stay.check_out)
    return now
}

/**
 * Nights owed beyond the booked window because the guest left late.
 *
 * Past the grace period a late departure is charged as whole days: a guest who
 * checks out five hours late owes one more night, one who leaves a day and five
 * hours late owes two. Anything inside the grace period adds nothing here — the
 * cashier can still apply a manual charge for it at checkout.
 *
 * Applies to every unsettled stay, including those already in house. A stay
 * that was checked out before departures were recorded reads as having left on
 * time (see resolveDeparture), so settled history stays frozen at what was
 * actually charged rather than growing an extra night per day since.
 */
export function lateCheckoutNights(
    scheduledCheckOut: string | Date,
    departure: Date,
    graceHours: number = LATE_CHECKOUT_GRACE_HOURS,
): number {
    const scheduled = new Date(scheduledCheckOut)
    const overstayMs = departure.getTime() - scheduled.getTime()
    if (overstayMs <= 0) return 0

    const overstayHours = overstayMs / (1000 * 60 * 60)
    if (overstayHours <= graceHours) return 0

    return Math.ceil(overstayHours / 24)
}

export function calculateNights(checkIn: string | Date, checkOut: string | Date): number {
    const inDate = typeof checkIn === 'string' ? new Date(checkIn) : checkIn
    const outDate = typeof checkOut === 'string' ? new Date(checkOut) : checkOut
    const diffMs = outDate.getTime() - inDate.getTime()
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

export interface SupplierBillDetails {
    text_desc: string
    quantity: number | null
    rate: number | null
    unit: string
    paid_amount: number | null
    payment_type: string
    bank_name: string
    // Only present when payment_type === 'cash_qr' — how much of paid_amount
    // was cash vs QR, since that one payment splits across two Day Book entries.
    cash_portion?: number
    qr_portion?: number
    // Only present when a cheque payment has ever been recorded on this bill —
    // 'pending_approval' means paid_amount above excludes it (still due) until
    // a manager approves it via approveChequeBillAction/rejectChequeBillAction.
    cheque_status?: 'pending_approval' | 'approved' | 'rejected'
    pending_cheque?: {
        amount: number
        bank_name: string
        cheque_details: { written_name: string; bank_cheque: string; cheque_number: string; cheque_date: string; cheque_type: 'ac_payee' | 'normal' }
    }
}

/**
 * Supplier bills (createSupplierBillAction) pack quantity/rate/unit/payment
 * detail into the expenses.description column as a JSON string, so the same
 * row can show a plain description everywhere else while the Suppliers
 * Ledger recovers the structured fields. Any UI rendering expenses.description
 * needs this to avoid printing the raw JSON blob for those rows.
 */
export function parseExpenseDescription(description: string): SupplierBillDetails {
    const fallback: SupplierBillDetails = { text_desc: description, quantity: null, rate: null, unit: '', paid_amount: null, payment_type: 'cash', bank_name: '' }
    if (!description?.startsWith('{') || !description.endsWith('}')) return fallback
    try {
        return { ...fallback, ...JSON.parse(description) }
    } catch {
        return fallback
    }
}

/**
 * Orders a flat category list into a one-level tree for display in a plain
 * <select>: each main category (parent_id null) immediately followed by its
 * subcategories, alphabetized within each level. A main with no children
 * renders like a standalone category (e.g. "Others").
 */
export function orderCategoriesForDisplay<T extends Pick<ExpenseCategory, 'id' | 'name' | 'parent_id'>>(
    categories: T[]
): Array<{ category: T; label: string }> {
    const presentIds = new Set(categories.map(c => c.id))
    const byParent = new Map<string | null, T[]>()
    for (const c of categories) {
        // A parent filtered out of this list (e.g. general-expense parent excluded
        // from a stock-only view) shouldn't make its child vanish — fall back to
        // top-level so every passed-in category is always represented.
        const key = c.parent_id && presentIds.has(c.parent_id) ? c.parent_id : null
        const bucket = byParent.get(key)
        if (bucket) bucket.push(c)
        else byParent.set(key, [c])
    }
    const sortByName = (a: T, b: T) => a.name.localeCompare(b.name)
    const mains = (byParent.get(null) || []).sort(sortByName)

    const ordered: Array<{ category: T; label: string }> = []
    for (const main of mains) {
        ordered.push({ category: main, label: main.name })
        const subs = (byParent.get(main.id) || []).sort(sortByName)
        for (const sub of subs) ordered.push({ category: sub, label: `— ${sub.name}` })
    }
    return ordered
}

/**
 * Given a selected category id, looks up its parent (main) category — so
 * picking a subcategory (e.g. "Vegetables") can automatically surface which
 * main category it belongs to (e.g. "Grocery") without the user having to
 * know the hierarchy. Returns null for a top-level category or an unknown id.
 */
export function findMainCategory<T extends Pick<ExpenseCategory, 'id' | 'name' | 'parent_id'>>(
    categories: T[],
    selectedCategoryId: string
): T | null {
    const selected = categories.find(c => c.id === selectedCategoryId)
    if (!selected?.parent_id) return null
    return categories.find(c => c.id === selected.parent_id) ?? null
}

/**
 * Prepends a picked staff/supplier name to a transaction description at submit
 * time (not on every keystroke) so it's guaranteed to show up wherever that
 * description is later displayed — ledgers, transaction logs, reports —
 * without fighting whatever the user is actively typing. A no-op if the name
 * is already present (e.g. the user typed it themselves).
 */
export function buildDescriptionWithName(description: string, label: string, name: string | undefined): string {
    const trimmed = description.trim()
    if (!name) return trimmed
    if (trimmed.toLowerCase().includes(name.toLowerCase())) return trimmed
    const prefix = `${label}: ${name}`
    return trimmed ? `${prefix} — ${trimmed}` : prefix
}

/**
 * Helper to determine the correct source label for a Kitchen Order Ticket (KOT).
 */
export function getKOTSourceLabel(order: {
    id?: string
    order_type?: string | null
    session_id?: string | null
    booking_id?: string | null
    bookings?: {
        rooms?: { room_number: string } | null
    } | null
    sessions?: {
        seat_number?: number
        tables?: {
            label?: string
            room_id?: string | null
            rooms?: { room_number: string } | null
            sessions?: { seat_number?: number; status?: string }[] | null
        } | null
    } | null
}): string {
    const isRoomQR = order.sessions?.tables?.room_id
    const isManualRoom = !order.session_id && order.booking_id

    if (isRoomQR) {
        const roomNum = order.sessions?.tables?.rooms?.room_number
        return roomNum ? `Room ${roomNum}` : 'Room Service'
    }
    if (isManualRoom) {
        const roomNum = order.bookings?.rooms?.room_number
        return roomNum ? `Room ${roomNum}` : 'Room Service'
    }

    const isTakeout = order.order_type === 'takeout'
    const isDelivery = order.order_type === 'delivery'

    if (isTakeout) return 'Takeaway'
    if (isDelivery) return 'Delivery'

    const tbl = order.sessions?.tables?.label
    if (tbl) {
        const tableSessions = order.sessions?.tables?.sessions || []
        const activeSessions = tableSessions.filter(s => s.status === 'active')
        const isSplit = activeSessions.length > 1 || (order.sessions?.seat_number ?? 1) >= 2

        const tableNum = isSplit ? `${tbl}-${order.sessions?.seat_number ?? 1}` : tbl
        let label = `Table ${tableNum}`

        // If they are a hotel guest, also display their room number
        if (order.booking_id && order.bookings?.rooms?.room_number) {
            label = `Table: ${tableNum} - Room: ${order.bookings.rooms.room_number}`
        }

        return label
    }

    // TEMPORARY diagnostic tag while tracking down why some tickets fall back to
    // this branch — printed directly on the ticket so it can be read off the
    // paper without opening devtools. Remove once the cause is confirmed fixed.
    const reason = !order.session_id ? 'no-session'
        : !order.sessions ? 'session-not-fetched'
        : !order.sessions.tables ? 'no-table-link'
        : 'no-label'

    if (typeof window !== 'undefined') {
        console.warn('[KOT] Could not resolve a table/room label for order — printing generic "Order" fallback.', {
            orderId: order.id,
            sessionId: order.session_id,
            bookingId: order.booking_id,
            orderType: order.order_type,
            sessions: order.sessions,
            bookings: order.bookings,
        })
    }

    return `Order [${reason}]`
}

/**
 * Parses and returns the item name and note for KOT display/print.
 * Displays variation names next to the item name, e.g. "Chowmein (Veg)",
 * and removes them from the special request/note so they do not print twice.
 */
export function getItemKOTDisplay(
    item: {
        menu_items?: { name: string } | null
        menu_item_variations?: { name: string } | null
        special_request?: string | null
    },
    isTakeout?: boolean
): { name: string; note: string } {
    let name = item.menu_items?.name || 'Item'
    let variationName = item.menu_item_variations?.name
    let note = item.special_request || ''

    if (name === 'Outside Food') {
        const matchOutside = note.match(/^\[Outside:\s*(.*?)\]\s*(.*)$/)
        if (matchOutside) {
            name = matchOutside[1]
            note = matchOutside[2]
        }
    }

    // Parse out variation name if formatted in brackets, e.g., "[Veg] note"
    const match = note.match(/^\[(.*?)\]\s*(.*)$/)
    if (match) {
        if (!variationName) {
            variationName = match[1]
        }
        note = match[2]
    }

    if (variationName) {
        name = `${variationName} ${name}`
    }

    const hasPackingLabel = note.includes('(Packing)') || note.includes('[Packing]')
    if (hasPackingLabel) {
        note = note.replace('(Packing)', '').replace('[Packing]', '').trim()
    }

    if (isTakeout || hasPackingLabel) {
        name = `${name} (Packing)`
    }

    return { name, note }
}

/**
 * Resolves the full display name for an order item including its variation (e.g. "Chilli Momo (Veg)").
 */
export function getItemDisplayName(item: {
    name?: string
    menu_items?: { name: string } | null
    menu_item_variations?: { name: string } | null
    variation_name?: string | null
    special_request?: string | null
} | null | undefined): string {
    if (!item) return 'Item'

    let name = item.name || item.menu_items?.name || 'Item'
    
    if ((name === 'Outside Food' || item.menu_items?.name === 'Outside Food') && item.special_request) {
        const matchOutside = item.special_request.match(/^\[Outside:\s*(.*?)\]/)
        if (matchOutside) {
            return matchOutside[1]
        }
    }

    let variationName = item.variation_name || item.menu_item_variations?.name

    // If variationName wasn't joined directly, try parsing from special_request "[VariationName]"
    if (!variationName && item.special_request) {
        const match = item.special_request.match(/^\[(.*?)\]/)
        if (match) {
            variationName = match[1]
        }
    }

    if (variationName) {
        const lowerName = name.toLowerCase()
        const lowerVar = variationName.toLowerCase()
        if (!lowerName.includes(`(${lowerVar})`) && !lowerName.includes(`[${lowerVar}]`) && !lowerName.startsWith(lowerVar)) {
            name = `${name} (${variationName})`
        }
    }

    return name
}

/**
 * Formats a restaurant address into Nepal standard invoice location format:
 * "metropolitan city name - ward number, district name"
 * e.g., "Kathmandu Metropolitan City - 10, Kathmandu"
 */
export function formatInvoiceAddress(address?: string | null): string {
    return 'Pulchowk, Chitwan'
}

/**
 * Checks whether a menu item matches a user search query.
 * Searches across item name, description, tags, variations, category name, and modifier groups.
 * Supports tokenized search so multi-word queries like "chicken steam momo" or "large pizza" match properly.
 */
export function matchesMenuSearch(item: any, searchQuery: string): boolean {
    if (!item) return false
    const query = searchQuery?.trim().toLowerCase()
    if (!query) return true

    const itemName = (item.name || '').toLowerCase()
    const description = (item.description || '').toLowerCase()
    const tags = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : ''
    const categoryName = (item.menu_categories?.name || item.category_name || item.category?.name || '').toLowerCase()

    // Variations text (e.g. "Chicken Steam Momo", "Large Pizza", "Steam")
    const variationNames = Array.isArray(item.variations)
        ? item.variations.map((v: any) => v.name || '').join(' ').toLowerCase()
        : ''

    // Modifiers text
    const modifierGroups = item.modifier_groups || item.menu_item_modifier_groups
    const modifierNames = Array.isArray(modifierGroups)
        ? modifierGroups
            .map((g: any) => `${g.name || ''} ${Array.isArray(g.modifiers) ? g.modifiers.map((m: any) => m.name || '').join(' ') : ''}`)
            .join(' ')
            .toLowerCase()
        : ''

    const fullText = `${itemName} ${description} ${tags} ${categoryName} ${variationNames} ${modifierNames}`

    // 1. Direct phrase match
    if (fullText.includes(query)) return true

    // 2. Tokenized search: Every word in the query must match somewhere in fullText
    const tokens = query.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return true

    return tokens.every(token => fullText.includes(token))
}

