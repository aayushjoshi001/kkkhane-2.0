import { cn } from '@/lib/utils'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Card from './Card'

type ChipTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const CHIP: Record<ChipTone, string> = {
    brand: 'bg-brand-50 text-brand-600',
    info: 'bg-info-bg text-info-fg',
    success: 'bg-success-bg text-success-fg',
    warning: 'bg-warning-bg text-warning-fg',
    danger: 'bg-danger-bg text-danger-fg',
    neutral: 'bg-surface-muted text-ink-muted',
}

export interface StatCardProps {
    label: string
    /** Pre-formatted value (e.g. "Rs. 12,480" or "37"). Rendered tabular. */
    value: React.ReactNode
    icon?: LucideIcon
    /** Tint of the icon chip — one per card, used sparingly. */
    tone?: ChipTone
    /** Signed delta vs. previous period, e.g. 18 or -4. */
    delta?: number | null
    /** Optional sub-label under the value. */
    hint?: string
    /** Adjusts padding, text sizing, and icon size for tighter layouts. */
    size?: 'default' | 'sm'
    className?: string
}

/**
 * KPI card. Equal height across a row, tinted icon chip, big tabular number,
 * optional success/danger delta chip. Hierarchy via size/weight, not color.
 */
export default function StatCard({
    label,
    value,
    icon: Icon,
    tone = 'neutral',
    delta,
    hint,
    size = 'default',
    className,
}: StatCardProps) {
    const hasDelta = typeof delta === 'number' && Number.isFinite(delta)
    const up = (delta ?? 0) >= 0
    const isSm = size === 'sm'
    return (
        <Card padding={isSm ? false : 20} className={cn(isSm ? 'gap-2 p-3' : 'gap-3', 'flex flex-col', className)}>
            <div className="flex items-start justify-between gap-3">
                {Icon && (
                    <span className={cn('grid place-items-center rounded-[var(--r-md)]', CHIP[tone], isSm ? 'size-7' : 'size-9')}>
                        <Icon size={isSm ? 14 : 18} strokeWidth={2} />
                    </span>
                )}
                {hasDelta && (
                    <span
                        className={cn(
                            'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption font-semibold tabular',
                            up ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg',
                        )}
                    >
                        {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {up ? '+' : '−'}{Math.abs(delta!)}%
                    </span>
                )}
            </div>
            <div className={cn("flex flex-col", isSm ? "gap-0" : "gap-0.5")}>
                <span className={cn("text-ink-subtle", isSm ? "text-[11px] uppercase tracking-wider font-bold" : "text-label")}>{label}</span>
                <span className={cn("tabular text-ink leading-none mt-1", isSm ? "text-h2" : "text-display")}>{value}</span>
                {hint && <span className={cn("text-ink-subtle", isSm ? "text-[10px] mt-0.5" : "text-caption mt-1")}>{hint}</span>}
            </div>
        </Card>
    )
}
