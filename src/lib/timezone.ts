// NST = UTC+5:45 (Nepal Standard Time). Shared by payroll accrual and staff
// attendance so "which calendar day" a moment falls on is consistent across
// features, matching the restaurant's local business day.
export const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000

// Returns the given moment's calendar date in NST, formatted YYYY-MM-DD.
export function getNstDateString(date: Date = new Date()): string {
    const nst = new Date(date.getTime() + NST_OFFSET_MS)
    return nst.toISOString().slice(0, 10)
}

const DATE_STRING_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateString(value: string): boolean {
    return DATE_STRING_RE.test(value)
}

// A staff member's effective join date: prefers the manager-set join_date (a
// plain calendar date), falling back to their account creation timestamp
// shifted into NST. Used consistently anywhere "which day did they start"
// needs to be derived, so payroll proration and salary-history backfill never
// disagree with each other over a single staff member's join day.
export function getEffectiveJoinDate(joinDate: string | null | undefined, createdAt: string): string {
    if (joinDate) return joinDate
    return getNstDateString(new Date(createdAt))
}

// Adds (or subtracts, for negative n) whole days to a YYYY-MM-DD date string,
// returning a YYYY-MM-DD string. Operates in UTC so there's no DST drift.
export function addDays(dateStr: string, n: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
}
