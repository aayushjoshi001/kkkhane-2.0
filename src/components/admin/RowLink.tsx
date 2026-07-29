'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A table row that navigates, for server-rendered tables.
 *
 * The dashboard's recent-orders and recent-bookings rows were styled
 * `cursor-pointer` but carried no handler — they invited a click and then did
 * nothing, which reads as a broken page rather than a missing feature.
 *
 * A `<tr>` cannot legally wrap an `<a>`, so navigation goes through the router.
 * The row is made focusable and responds to Enter and Space so it is reachable
 * without a mouse, which a bare onClick would not be.
 */
export default function RowLink({
    href,
    children,
    className,
}: {
    href: string
    children: ReactNode
    className?: string
}) {
    const router = useRouter()

    const go = () => router.push(href)

    return (
        <tr
            role="link"
            tabIndex={0}
            onClick={go}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    go()
                }
            }}
            className={cn(
                'cursor-pointer transition-colors hover:bg-surface-muted/50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-inset',
                className
            )}
        >
            {children}
        </tr>
    )
}
