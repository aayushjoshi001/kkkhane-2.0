import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export interface EmptyStateProps {
    icon?: LucideIcon
    title: string
    description?: string
    /** Optional primary action (already a Button or link). */
    action?: React.ReactNode
    /** Dark variant for KDS / dark surfaces. */
    dark?: boolean
    className?: string
    compact?: boolean
}

/**
 * Designed empty state — centered muted icon + one-line message + optional
 * action. Use instead of leaving a data surface blank.
 */
export default function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    dark,
    compact,
    className,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center text-center',
                compact ? 'gap-2 py-8' : 'gap-3 py-12',
                className,
            )}
        >
            {Icon && (
                <span
                    className={cn(
                        'grid place-items-center rounded-full',
                        compact ? 'size-10' : 'size-12',
                        dark ? 'bg-surface/5 text-dark-muted' : 'bg-surface-muted text-ink-subtle',
                    )}
                >
                    <Icon size={compact ? 18 : 22} strokeWidth={2} />
                </span>
            )}
            <div className="flex flex-col gap-1">
                <p className={cn('text-h3', dark ? 'text-dark-ink' : 'text-ink')}>{title}</p>
                {description && (
                    <p className={cn('text-small max-w-xs', dark ? 'text-dark-muted' : 'text-ink-muted')}>
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="mt-1">{action}</div>}
        </div>
    )
}
