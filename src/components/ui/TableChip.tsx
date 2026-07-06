import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
    sm: 'size-8 text-caption',
    md: 'size-10 text-small',
    lg: 'size-12 text-h3',
}

export interface TableChipProps {
    /** Short label, e.g. "T3", "12", "TA". */
    label: string
    size?: Size
    /** Dark surface (KDS). */
    dark?: boolean
    className?: string
}

/**
 * Fixed-square, brand-tinted table chip. ALWAYS square and identical size for a
 * given `size` — use everywhere a table identifier appears so chips never vary
 * between square and wide.
 */
export default function TableChip({ label, size = 'md', dark, className }: TableChipProps) {
    return (
        <span
            className={cn(
                'inline-grid shrink-0 place-items-center rounded-[var(--r-md)] font-bold tabular leading-none',
                dark ? 'bg-surface/10 text-dark-ink' : 'bg-brand-50 text-brand-700',
                SIZES[size],
                className,
            )}
        >
            <span className="truncate px-1">{label}</span>
        </span>
    )
}
