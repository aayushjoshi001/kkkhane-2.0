// src/lib/utils.ts
// Shared utility functions

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AdvancePaymentMethod, ExpenseCategory } from '@/types/database'

/**
 * Merge class names with Tailwind-aware deduplication.
 * clsx joins conditionals; twMerge resolves conflicting utilities so a
 * caller-supplied className always wins over a primitive's defaults.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
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
 * Format ISO datetime string into human readable locale string.
 */
export function formatDateTime(dateStr: string | Date | null | undefined): string {
    if (!dateStr) return '-'
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
    return date.toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
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

        let label = `Table ${tbl}`
        if (isSplit) {
            label = `Table ${tbl}-${order.sessions?.seat_number ?? 1}`
        }

        // If they are a hotel guest, also display their room number
        if (order.booking_id && order.bookings?.rooms?.room_number) {
            label += ` (Room ${order.bookings.rooms.room_number})`
        }

        return label
    }

    return 'Order'
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

