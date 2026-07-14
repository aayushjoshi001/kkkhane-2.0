// src/lib/utils.ts
// Shared utility functions

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AdvancePaymentMethod } from '@/types/database'

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
