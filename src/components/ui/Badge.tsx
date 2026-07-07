import { cn } from '@/lib/utils'

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'brand'

const TONES: Record<Tone, string> = {
    success: 'bg-success-bg text-success-fg',
    info: 'bg-info-bg text-info-fg',
    warning: 'bg-warning-bg text-warning-fg',
    danger: 'bg-danger-bg text-danger-fg',
    neutral: 'bg-[var(--neutral-badge-bg)] text-[var(--neutral-badge-fg)]',
    brand: 'bg-brand-50 text-brand-700',
}

const DOT: Record<Tone, string> = {
    success: 'bg-success',
    info: 'bg-info',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-[var(--text-subtle)]',
    brand: 'bg-brand-500',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    tone?: Tone
    /** Show a leading status dot. */
    dot?: boolean
}

/** Generic pill. One radius, one type size, fixed semantic tones. */
export function Badge({ tone = 'neutral', dot, className, children, ...props }: BadgeProps) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold',
                TONES[tone],
                className,
            )}
            {...props}
        >
            {dot && <span className={cn('size-1.5 rounded-full', DOT[tone])} aria-hidden />}
            {children}
        </span>
    )
}

/* ── Canonical status → tone + label map ─────────────────────────
   The single source of truth so a "Ready" badge is identical on
   Waiter, KDS and Admin. Covers order / payment / takeout / service
   / table / session statuses. */
const STATUS: Record<string, { tone: Tone; label: string }> = {
    // Order
    pending: { tone: 'warning', label: 'Pending' },
    new: { tone: 'warning', label: 'New' },
    confirmed: { tone: 'info', label: 'Confirmed' },
    preparing: { tone: 'info', label: 'Preparing' },
    ready: { tone: 'success', label: 'Ready' },
    delivered: { tone: 'neutral', label: 'Delivered' },
    served: { tone: 'neutral', label: 'Served' },
    completed: { tone: 'success', label: 'Completed' },
    cancelled: { tone: 'danger', label: 'Cancelled' },
    closed: { tone: 'neutral', label: 'Closed' },
    expired: { tone: 'neutral', label: 'Expired' },
    // Payment
    unpaid: { tone: 'warning', label: 'Unpaid' },
    paid: { tone: 'success', label: 'Paid' },
    verified: { tone: 'success', label: 'Verified' },
    refunded: { tone: 'neutral', label: 'Refunded' },
    failed: { tone: 'danger', label: 'Failed' },
    rejected: { tone: 'danger', label: 'Rejected' },
    // Takeout
    placed: { tone: 'warning', label: 'Placed' },
    ready_for_pickup: { tone: 'success', label: 'Ready' },
    picked_up: { tone: 'neutral', label: 'Picked up' },
    // Service request
    acknowledged: { tone: 'info', label: 'Acknowledged' },
    // Table / session
    available: { tone: 'success', label: 'Available' },
    occupied: { tone: 'info', label: 'Occupied' },
    reserved: { tone: 'info', label: 'Reserved' },
    dirty: { tone: 'warning', label: 'Needs cleaning' },
    active: { tone: 'success', label: 'Active' },
    // Finance
    draft: { tone: 'neutral', label: 'Draft' },
    posted: { tone: 'success', label: 'Posted' },
    void: { tone: 'danger', label: 'Void' },
    partial: { tone: 'warning', label: 'Partial' },
    open: { tone: 'info', label: 'Open' },
    approved: { tone: 'success', label: 'Approved' },
    // Financial Event Engine — statusMeta() lowercases its lookup key, so these
    // match regardless of the uppercase PENDING/PROCESSING/... values stored on
    // financial_events.status. 'pending' and 'failed' are already covered above.
    processing: { tone: 'info', label: 'Processing' },
    processed: { tone: 'success', label: 'Processed' },
    reversed: { tone: 'neutral', label: 'Reversed' },
}

export function statusMeta(status: string): { tone: Tone; label: string } {
    return STATUS[status?.toLowerCase()] ?? { tone: 'neutral', label: status ?? '—' }
}

export interface StatusBadgeProps extends Omit<BadgeProps, 'tone' | 'children'> {
    status: string
    /** Override the auto label (keeps the mapped tone). */
    label?: string
}

/** Status pill with fixed tone + dot. `<StatusBadge status="ready" />`. */
export function StatusBadge({ status, label, dot = true, ...props }: StatusBadgeProps) {
    const meta = statusMeta(status)
    return (
        <Badge tone={meta.tone} dot={dot} {...props}>
            {label ?? meta.label}
        </Badge>
    )
}

export default StatusBadge
