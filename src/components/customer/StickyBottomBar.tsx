import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The fixed, surface-coloured action bar pinned to the bottom of the customer
 * flow screens (takeout menu, takeout form, dine-in checkout). It owns the
 * shared shell — fixed positioning, top border, surface background, padding, and
 * a centered inner container — so each screen only supplies its own content.
 *
 * `className` overrides shell utilities via tailwind-merge (e.g. a different
 * `z-*`, a `bottom-[88px]` offset to clear the BottomNavbar, or a shadow).
 * `innerClassName` sets the inner container width/layout (defaults to max-w-xl).
 */
export default function StickyBottomBar({
    children,
    className,
    innerClassName = 'max-w-xl',
}: {
    children: ReactNode
    className?: string
    innerClassName?: string
}) {
    return (
        <div className={cn('fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-hairline-strong p-4', className)}>
            <div className={cn('mx-auto', innerClassName)}>{children}</div>
        </div>
    )
}
