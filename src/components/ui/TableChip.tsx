import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
    sm: 'h-8 min-w-[2rem] px-2 text-caption',
    md: 'h-10 min-w-[2.5rem] px-2.5 text-small',
    lg: 'h-12 min-w-[3rem] px-3 text-h3',
}

export interface TableChipProps {
    /** Short label, e.g. "T3", "12", "TA". Long labels will expand into a pill shape. */
    label: string
    size?: Size
    /** Dark surface (KDS). */
    dark?: boolean
    className?: string
}

/**
 * Responsive table chip. Square for short labels, expands into a pill for long ones.
 */
export default function TableChip({ label, size = 'md', dark, className }: TableChipProps) {
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-[var(--r-md)] font-bold tabular leading-none max-w-[200px]',
                dark ? 'bg-surface/10 text-dark-ink' : 'bg-brand-50 text-brand-700',
                SIZES[size],
                className,
            )}
        >
            <span className="truncate min-w-0">{label}</span>
        </span>
    )
}

